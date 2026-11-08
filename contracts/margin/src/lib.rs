// MARGIN arena contract: holds player USDC, paid-match tickets, the LP vault and log anchors.
// Ticket model (EDGE-CASES NS-10/12/17): a stake lives in a per-account ticket, one settle tx
// per match moves everything with an exact equality, and a stuck ticket is reclaimable after 15 min.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue, env, near, require};

/// Smallest deposit we credit, in USDC base units (0.1 USDC). Every new balance row costs the
/// contract storage, so dust deposits from throwaway accounts are refunded instead.
pub const MIN_DEPOSIT: u128 = 100_000;

/// RULES.html TICKET_REFUND_DEADLINE_MIN, in nanoseconds (block timestamps are ns).
pub const TICKET_DEADLINE_NS: u64 = 15 * 60 * 1_000_000_000;

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Balances,
    Tickets,
    Matches,
    Anchors,
}

/// A paid stake waiting for (or assigned to) a match. At most one live ticket per account.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Ticket {
    pub stake: U128,
    pub entered_at: u64,
    pub match_id: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum MatchStatus {
    Open,
    Settled,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Match {
    pub players: Vec<AccountId>,
    pub stakes: U128,
    /// Vault money reserved at open: (LEVERAGE_CAP - 1) * stakes. Must come back in full at settle.
    pub budget: U128,
    pub status: MatchStatus,
    pub seq: u64,
    pub head: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Vault {
    /// Liquidity that can back new matches.
    pub free: U128,
    /// Budgets reserved by open matches.
    pub locked: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Anchor {
    pub seq: u64,
    pub head: String,
    pub at: u64,
}

/// ft_on_transfer msg. Empty msg credits the sender. Unknown fields are rejected so a typo
/// refunds the deposit instead of crediting someone unintended.
#[derive(Deserialize, Default)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct DepositMsg {
    #[serde(rename = "for")]
    for_account: Option<AccountId>,
    #[serde(default)]
    vault: bool,
}

/// NEP-297 event log line, read by the game server from tx outcomes (no indexer).
fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "margin", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub settler: AccountId,
    pub usdc: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    settler: AccountId,
    usdc: AccountId,
    balances: LookupMap<AccountId, u128>,
    tickets: LookupMap<AccountId, Ticket>,
    matches: LookupMap<String, Match>,
    anchors: LookupMap<String, Anchor>,
    vault: Vault,
    reserve: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, settler: AccountId, usdc: AccountId) -> Self {
        Self {
            owner,
            settler,
            usdc,
            balances: LookupMap::new(Key::Balances),
            tickets: LookupMap::new(Key::Tickets),
            matches: LookupMap::new(Key::Matches),
            anchors: LookupMap::new(Key::Anchors),
            vault: Vault::default(),
            reserve: 0,
        }
    }

    /// NEP-141 receiver. Returns the unused amount (refund) instead of panicking on a bad msg,
    /// so a malformed Intents delivery never loses funds. Only our USDC is accepted.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "only the configured USDC is accepted");
        let parsed = if msg.is_empty() {
            Some(DepositMsg::default())
        } else {
            serde_json::from_str::<DepositMsg>(&msg).ok()
        };
        let refund = PromiseOrValue::Value(amount);
        let Some(m) = parsed else { return refund };
        if amount.0 < MIN_DEPOSIT {
            return refund;
        }
        if m.vault {
            // Owner-only LP for the hackathon (public LP is cut). A stray vault msg is refunded.
            if m.for_account.is_some() || sender_id != self.owner {
                return refund;
            }
            self.vault.free = U128(self.vault.free.0.checked_add(amount.0).expect("vault overflow"));
            emit("vault_deposit", json!({"amount": amount}));
        } else {
            let to = m.for_account.unwrap_or(sender_id);
            self.credit(&to, amount.0);
            emit("deposit", json!({"account_id": to, "amount": amount}));
        }
        PromiseOrValue::Value(U128(0))
    }

    /// Idle USDC of an account, in base units (6 decimals).
    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn vault(&self) -> Vault {
        self.vault.clone()
    }

    pub fn config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            settler: self.settler.clone(),
            usdc: self.usdc.clone(),
        }
    }
}

impl Contract {
    fn credit(&mut self, account: &AccountId, amount: u128) {
        let b = self.balances.entry(account.clone()).or_insert(0);
        *b = b.checked_add(amount).expect("balance overflow");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn setup(caller: &str) -> Contract {
        testing_env!(VMContextBuilder::new().predecessor_account_id(acc(caller)).build());
        Contract::new(acc("owner.near"), acc("settler.near"), acc("usdc.near"))
    }

    fn unused(r: PromiseOrValue<U128>) -> u128 {
        match r {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("unexpected promise"),
        }
    }

    #[test]
    fn deposit_credits_sender_or_for() {
        let mut c = setup("usdc.near");
        assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(1_000_000), "".into())), 0);
        let msg = r#"{"for":"b.near"}"#.to_string();
        assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(2_000_000), msg)), 0);
        assert_eq!(c.balance_of(acc("a.near")).0, 1_000_000);
        assert_eq!(c.balance_of(acc("b.near")).0, 2_000_000);
    }

    #[test]
    fn bad_msg_dust_and_stray_vault_are_refunded() {
        let mut c = setup("usdc.near");
        for msg in ["nope", r#"{"to":"b.near"}"#, r#"{"vault":true}"#] {
            assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(1_000_000), msg.into())), 1_000_000);
        }
        assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(MIN_DEPOSIT - 1), "".into())), MIN_DEPOSIT - 1);
        assert_eq!(c.balance_of(acc("a.near")).0, 0);
        assert_eq!(c.vault().free.0, 0);
    }

    #[test]
    fn owner_funds_vault() {
        let mut c = setup("usdc.near");
        let msg = r#"{"vault":true}"#.to_string();
        assert_eq!(unused(c.ft_on_transfer(acc("owner.near"), U128(5_000_000), msg)), 0);
        assert_eq!(c.vault().free.0, 5_000_000);
    }

    #[test]
    #[should_panic(expected = "only the configured USDC")]
    fn wrong_token_panics() {
        let mut c = setup("fake.near");
        let _ = c.ft_on_transfer(acc("a.near"), U128(1_000_000), "".into());
    }
}
