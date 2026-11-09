// USDC deposits (NEP-141 receiver). Player deposits arrive via 1-Click with {"for": player},
// or directly with an empty msg. The owner funds the vault with {"vault": true}.

use crate::*;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;
use near_sdk::PromiseOrValue;

/// ft_on_transfer msg. Unknown fields are rejected so a typo refunds the deposit instead of
/// crediting someone unintended.
#[derive(Deserialize, Default)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct DepositMsg {
    #[serde(rename = "for")]
    for_account: Option<AccountId>,
    #[serde(default)]
    vault: bool,
}

#[near]
impl Contract {
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
            self.vault.free = U128(add(self.vault.free.0, amount.0));
            emit("vault_deposit", format!(r#"{{"amount":"{}"}}"#, amount.0));
        } else {
            let to = m.for_account.unwrap_or(sender_id);
            self.credit(&to, amount.0);
            emit("deposit", format!(r#"{{"account_id":{},"amount":"{}"}}"#, j(&to), amount.0));
        }
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests {
    use crate::test_utils::*;
    use crate::*;
    use near_sdk::PromiseOrValue;

    fn unused(r: PromiseOrValue<U128>) -> u128 {
        match r {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("unexpected promise"),
        }
    }

    #[test]
    fn deposit_credits_sender_or_for() {
        let mut c = setup();
        ctx("usdc.near", 0, 0);
        assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(1_000_000), "".into())), 0);
        let msg = r#"{"for":"b.near"}"#.to_string();
        assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(2_000_000), msg)), 0);
        assert_eq!(c.balance_of(acc("a.near")).0, 1_000_000);
        assert_eq!(c.balance_of(acc("b.near")).0, 2_000_000);
    }

    #[test]
    fn bad_msg_dust_and_stray_vault_are_refunded() {
        let mut c = setup();
        ctx("usdc.near", 0, 0);
        for msg in ["nope", r#"{"to":"b.near"}"#, r#"{"vault":true}"#] {
            assert_eq!(unused(c.ft_on_transfer(acc("a.near"), U128(1_000_000), msg.into())), 1_000_000);
        }
        let dust = U128(MIN_DEPOSIT - 1);
        assert_eq!(unused(c.ft_on_transfer(acc("a.near"), dust, "".into())), MIN_DEPOSIT - 1);
        assert_eq!(c.balance_of(acc("a.near")).0, 0);
        assert_eq!(c.vault().free.0, 0);
    }

    #[test]
    fn owner_funds_vault() {
        let mut c = setup();
        ctx("usdc.near", 0, 0);
        let msg = r#"{"vault":true}"#.to_string();
        assert_eq!(unused(c.ft_on_transfer(acc("owner.near"), U128(5_000_000), msg)), 0);
        assert_eq!(c.vault().free.0, 5_000_000);
    }

    #[test]
    fn new_owner_can_fund_vault_old_cannot() {
        let mut c = setup();
        ctx("owner.near", 1, 0);
        c.set_owner(acc("lp.near"));
        ctx("usdc.near", 0, 0);
        let msg = r#"{"vault":true}"#.to_string();
        assert_eq!(unused(c.ft_on_transfer(acc("owner.near"), U128(1_000_000), msg.clone())), 1_000_000);
        assert_eq!(unused(c.ft_on_transfer(acc("lp.near"), U128(1_000_000), msg)), 0);
    }

    /// N11 H1: a function-call login key (no deposit) cannot hand the vault to someone else.
    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn set_owner_needs_one_yocto() {
        let mut c = setup();
        ctx("owner.near", 0, 0);
        c.set_owner(acc("thief.near"));
    }

    #[test]
    #[should_panic(expected = "only the configured USDC")]
    fn wrong_token_panics() {
        let mut c = setup();
        ctx("fake.near", 0, 0);
        let _ = c.ft_on_transfer(acc("a.near"), U128(1_000_000), "".into());
    }
}
