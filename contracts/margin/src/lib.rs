// MARGIN arena contract: holds player USDC, paid-match tickets, the LP vault and log anchors.
// Ticket model (EDGE-CASES NS-10/12/17): a stake lives in a per-account ticket, one settle tx
// per match moves everything with an exact equality, and a stuck ticket is reclaimable after 15 min.

mod arena;
mod deposit;
mod withdraw;

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::serde_json;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, assert_one_yocto, env, near, require};

/// Smallest deposit we credit, in USDC base units (0.1 USDC). Every new balance row costs the
/// contract storage, so dust deposits from throwaway accounts are refunded instead.
pub const MIN_DEPOSIT: u128 = 100_000;

/// Default paid entry: RULES.html ENTRY_PAID_USDC (1 USDC, 6 decimals). The live value is
/// state (`entry_stake`), set at init or by the owner, so mainnet can launch at 0.10 USDC.
pub const ENTRY_STAKE: u128 = 1_000_000;

/// RULES.html ROOM_VAULT_BUDGET = (LEVERAGE_CAP - 1) * pot, as basis points of the stakes.
pub const BUDGET_BPS: u128 = 15_000;

/// RULES.html ROOM_SIZE 12, with headroom. Payouts only reach match players (drone bounties ride
/// in `reserve`), so this only bounds settle gas and the args size.
pub const MAX_PAYOUTS: usize = 16;

/// Settler-supplied strings are stored forever at the contract's storage cost, so cap them.
pub const MAX_ID_LEN: usize = 64;
pub const MAX_HEAD_LEN: usize = 128;

/// RULES.html TICKET_REFUND_DEADLINE_MIN, in nanoseconds (block timestamps are ns).
pub const TICKET_DEADLINE_NS: u64 = 15 * 60 * 1_000_000_000;

/// Most bad debt one match may push onto the house reserve, in bps of its budget. The keeper pops
/// at HF 0.90 so honest bad debt is ~0: this bounds what a leaked settler key can take (N11 H2).
pub const BAD_DEBT_MAX_BPS: u128 = 1_000;

/// The only anchor key: the hourly Merkle root of free matches. Paid heads land in settle.
/// One fixed key stops a leaked settler key from bloating storage with new ids (N11 M2).
pub const ANCHOR_ROOM: &str = "free";

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
    /// Vault money reserved at open: (LEVERAGE_CAP - 1) * stakes.
    pub budget: U128,
    pub status: MatchStatus,
    /// Block time at open (ns). Reclaim deadlines for assigned tickets count from here.
    pub opened_at: u64,
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

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub settler: AccountId,
    pub usdc: AccountId,
    /// The one paid entry, USDC base units. Client and server read it from here.
    pub entry_stake: U128,
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
    /// House reserve (fees, rounding dust). First line of defence for vault bad debt.
    reserve: u128,
    /// Paid entry in USDC base units (appended last: migrate() reads the V1 layout before it).
    entry_stake: u128,
}

/// State layout before entry_stake existed. Only migrate() reads it.
#[near(serializers = [borsh])]
pub struct ContractV1 {
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

/// NEP-297 event log line, read by the game server from tx outcomes (no indexer).
/// `data` is one JSON object. Built with format! because serde_json::Value cost ~KB of wasm.
pub(crate) fn emit(event: &str, data: String) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"margin","version":"1.0.0","event":"{event}","data":[{data}]}}"#
    ));
}

/// JSON-encode one value (escapes user-supplied ids and hashes).
pub(crate) fn j<T: Serialize + ?Sized>(v: &T) -> String {
    serde_json::to_string(v).expect("json")
}

/// A stake must be at least MIN_DEPOSIT and divide 100,000,000: core counts 1 USDC as 1e8 Micro,
/// so Micro per base unit (1e8 / stake) must be whole or paid settles cannot be exact.
/// Valid: 100000 (0.10), 200000, 250000, 500000, 1000000 (1 USDC).
pub(crate) fn check_stake(stake: u128) {
    require!(stake >= MIN_DEPOSIT, "entry stake below the minimum deposit");
    require!(100_000_000 % stake == 0, "entry stake must divide 100000000 (e.g. 100000 or 1000000)");
}

pub(crate) fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).expect("overflow")
}

pub(crate) fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).expect("underflow")
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, settler: AccountId, usdc: AccountId, entry_stake: Option<U128>) -> Self {
        require!(owner != env::current_account_id(), "owner must not be the contract account");
        let entry_stake = entry_stake.map_or(ENTRY_STAKE, |s| s.0);
        check_stake(entry_stake);
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
            entry_stake,
        }
    }

    /// Upgrade path: deploy new code and call this in the same tx. Reads the V1 layout and
    /// adds entry_stake. Every future state change gets its own ContractVn + migrate.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(entry_stake: Option<U128>) -> Self {
        let v1: ContractV1 = env::state_read().expect("no V1 state");
        let ContractV1 { owner, settler, usdc, balances, tickets, matches, anchors, vault, reserve } = v1;
        let entry_stake = entry_stake.map_or(ENTRY_STAKE, |s| s.0);
        check_stake(entry_stake);
        Self { owner, settler, usdc, balances, tickets, matches, anchors, vault, reserve, entry_stake }
    }

    /// Owner: change the paid entry (e.g. 0.10 USDC for a cheap mainnet launch). Live tickets keep
    /// the stake they paid, matches sum real ticket stakes, so a change mid-queue stays exact.
    #[payable]
    pub fn set_entry_stake(&mut self, entry_stake: U128) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        check_stake(entry_stake.0);
        self.entry_stake = entry_stake.0;
        emit("entry_stake_changed", format!(r#"{{"entry_stake":"{}"}}"#, entry_stake.0));
    }

    /// Idle USDC of an account, in base units (6 decimals).
    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn vault(&self) -> Vault {
        self.vault.clone()
    }

    pub fn reserve(&self) -> U128 {
        U128(self.reserve)
    }

    pub fn ticket_of(&self, account_id: AccountId) -> Option<Ticket> {
        self.tickets.get(&account_id).cloned()
    }

    pub fn match_of(&self, match_id: String) -> Option<Match> {
        self.matches.get(&match_id).cloned()
    }

    pub fn anchor_of(&self, room_id: String) -> Option<Anchor> {
        self.anchors.get(&room_id).cloned()
    }

    /// Owner: hand ownership to another account. The owner must not be the contract account
    /// itself, because NEP-141 forbids ft_transfer_call to self (the vault could never be funded).
    /// 1 yocto: a dApp login key (function-call, no deposit) can never take the vault (N11 H1).
    #[payable]
    pub fn set_owner(&mut self, owner: AccountId) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        require!(owner != env::current_account_id(), "owner must not be the contract account");
        emit("owner_changed", format!(r#"{{"from":{},"to":{}}}"#, j(&self.owner), j(&owner)));
        self.owner = owner;
    }

    /// Owner: rotate the settler key (a leaked settler key needs no redeploy).
    #[payable]
    pub fn set_settler(&mut self, settler: AccountId) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        emit("settler_changed", format!(r#"{{"from":{},"to":{}}}"#, j(&self.settler), j(&settler)));
        self.settler = settler;
    }

    pub fn config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            settler: self.settler.clone(),
            usdc: self.usdc.clone(),
            entry_stake: U128(self.entry_stake),
        }
    }
}

impl Contract {
    pub(crate) fn credit(&mut self, account: &AccountId, amount: u128) {
        let b = self.balances.entry(account.clone()).or_insert(0);
        *b = add(*b, amount);
    }

    pub(crate) fn debit(&mut self, account: &AccountId, amount: u128) {
        let b = self.balances.get_mut(account).expect("no balance");
        require!(*b >= amount, "insufficient balance");
        *b -= amount;
        if *b == 0 {
            self.balances.remove(account); // the contract pays storage, so drop empty rows (N11 M1)
        }
    }

    pub(crate) fn assert_settler(&self) {
        require!(env::predecessor_account_id() == self.settler, "only the settler");
    }
}

#[cfg(test)]
mod test_utils {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    pub fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    /// Sets the caller, attached yocto and block time (ns) for the next calls.
    pub fn ctx(caller: &str, yocto: u128, now_ns: u64) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(acc(caller))
                .attached_deposit(near_sdk::NearToken::from_yoctonear(yocto))
                .block_timestamp(now_ns)
                .build()
        );
    }

    pub fn setup() -> Contract {
        ctx("owner.near", 0, 0);
        Contract::new(acc("owner.near"), acc("settler.near"), acc("usdc.near"), None)
    }
}
