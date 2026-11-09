// Withdrawals. The balance is debited BEFORE the ft_transfer (no reentrancy window) and
// re-credited by a private callback if the transfer fails (e.g. receiver not registered on USDC).
// 1 yocto forces a full-access key, so a leaked session key can never withdraw.

use crate::*;
use near_sdk::{Gas, NearToken, Promise, PromiseError, ext_contract};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Contract {
    /// Sends `amount` USDC base units from the caller's idle balance to their wallet.
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        require!(amount.0 > 0, "amount must be positive");
        let who = env::predecessor_account_id();
        self.debit(&who, amount.0);
        self.send(who, amount)
    }

    /// Owner: move free vault liquidity to the owner's idle balance (then `withdraw`).
    #[payable]
    pub fn vault_withdraw(&mut self, amount: U128) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        self.vault.free = U128(sub(self.vault.free.0, amount.0));
        let owner = self.owner.clone();
        self.credit(&owner, amount.0);
        emit("vault_withdraw", format!(r#"{{"amount":"{}"}}"#, amount.0));
    }

    /// Owner: move house reserve (fees, dust) to the owner's idle balance (then `withdraw`).
    #[payable]
    pub fn reserve_withdraw(&mut self, amount: U128) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        self.reserve = sub(self.reserve, amount.0);
        // Open matches may each draw bad debt up to BAD_DEBT_MAX_BPS of their budget (N11 L2).
        require!(self.reserve >= self.vault.locked.0 * BAD_DEBT_MAX_BPS / 10_000, "reserve backs open matches");
        let owner = self.owner.clone();
        self.credit(&owner, amount.0);
        emit("reserve_withdraw", format!(r#"{{"amount":"{}"}}"#, amount.0));
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        account_id: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            emit("withdraw", format!(r#"{{"account_id":{},"amount":"{}"}}"#, j(&account_id), amount.0));
            return true;
        }
        self.credit(&account_id, amount.0);
        emit("withdraw_failed", format!(r#"{{"account_id":{},"amount":"{}"}}"#, j(&account_id), amount.0));
        false
    }
}

impl Contract {
    fn send(&self, to: AccountId, amount: U128) -> Promise {
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to.clone(), amount, None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw(to, amount),
            )
    }
}

#[cfg(test)]
mod tests {
    use crate::test_utils::*;
    use crate::*;

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn withdraw_needs_one_yocto() {
        let mut c = setup();
        c.credit(&acc("a.near"), 1_000_000);
        ctx("a.near", 0, 0);
        let _ = c.withdraw(U128(1));
    }

    #[test]
    fn withdraw_debits_first() {
        let mut c = setup();
        c.credit(&acc("a.near"), 1_000_000);
        ctx("a.near", 1, 0);
        let _ = c.withdraw(U128(400_000));
        assert_eq!(c.balance_of(acc("a.near")).0, 600_000);
    }

    /// N11 M1: an emptied balance row is deleted, so the contract stops paying its storage.
    #[test]
    fn empty_balance_row_removed() {
        let mut c = setup();
        c.credit(&acc("a.near"), 1_000_000);
        ctx("a.near", 1, 0);
        let _ = c.withdraw(U128(1_000_000));
        assert!(!c.balances.contains_key(&acc("a.near")));
    }

    /// N11 L2: the owner cannot pull the reserve below what open matches may need for bad debt.
    #[test]
    #[should_panic(expected = "reserve backs open matches")]
    fn reserve_floor_while_matches_open() {
        let mut c = setup();
        c.reserve = 1_000_000;
        c.vault.locked = U128(3_000_000);
        ctx("owner.near", 1, 0);
        c.reserve_withdraw(U128(800_000));
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn withdraw_over_balance_rejected() {
        let mut c = setup();
        c.credit(&acc("a.near"), 1_000_000);
        ctx("a.near", 1, 0);
        let _ = c.withdraw(U128(1_000_001));
    }
}
