// MARGIN arena contract: holds player USDC, paid-match tickets, the LP vault and log anchors.
// Ticket model (EDGE-CASES NS-10/12/17): a stake lives in a per-account ticket, one settle tx
// per match moves everything with an exact equality, and a stuck ticket is reclaimable after 15 min.

use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, near};

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
    pub stake: u128,
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
    pub stakes: u128,
    /// Vault money reserved at open: (LEVERAGE_CAP - 1) * stakes. Must come back in full at settle.
    pub budget: u128,
    pub status: MatchStatus,
    pub seq: u64,
    pub head: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Vault {
    /// Liquidity that can back new matches.
    pub free: u128,
    /// Budgets reserved by open matches.
    pub locked: u128,
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

    pub fn config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            settler: self.settler.clone(),
            usdc: self.usdc.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_stores_roles() {
        let c = Contract::new(
            "owner.near".parse().unwrap(),
            "settler.near".parse().unwrap(),
            "usdc.near".parse().unwrap(),
        );
        let cfg = c.config();
        assert_eq!(cfg.settler.as_str(), "settler.near");
        assert_eq!(cfg.usdc.as_str(), "usdc.near");
    }
}
