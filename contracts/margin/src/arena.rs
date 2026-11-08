// Paid-match lifecycle: enter (ticket) -> open_match (assign + reserve vault budget) -> settle.
// Settle and reclaim both consume tickets inside one receipt, so exactly one of them wins
// (EDGE-CASES NS-12). No global heartbeat: every ticket carries its own 15 min deadline.

use crate::*;

#[near]
impl Contract {
    /// Moves ENTRY_STAKE from the caller's balance into a ticket. Callable with a session
    /// (function-call) key: no deposit needed, and it can never move money out of the contract.
    pub fn enter_arena(&mut self, stake: U128) {
        let player = env::predecessor_account_id();
        require!(stake.0 == ENTRY_STAKE, "stake must be exactly 1 USDC");
        require!(!self.tickets.contains_key(&player), "already holding a ticket");
        self.debit(&player, stake.0);
        let ticket = Ticket { stake, entered_at: env::block_timestamp(), match_id: None };
        self.tickets.insert(player.clone(), ticket);
        emit("enter", format!(r#"{{"account_id":{},"stake":"{}"}}"#, j(&player), stake.0));
    }

    /// Settler, at GO: binds the players' tickets to the match and reserves the room's vault
    /// budget, so the room can lend instantly without an on-chain draw per BOOST (NS-17).
    pub fn open_match(&mut self, match_id: String, players: Vec<AccountId>) {
        self.assert_settler();
        require!(match_id.len() <= MAX_ID_LEN, "match_id too long");
        require!(!self.matches.contains_key(&match_id), "match id already used");
        require!(!players.is_empty() && players.len() <= 12, "1 to 12 players");
        let mut stakes = 0u128;
        for p in &players {
            // A duplicate player fails here: its ticket was assigned on the first pass.
            let t = self.tickets.get_mut(p).expect("player has no ticket");
            require!(t.match_id.is_none(), "ticket already assigned");
            t.match_id = Some(match_id.clone());
            stakes = add(stakes, t.stake.0);
        }
        let budget = stakes.checked_mul(BUDGET_BPS).expect("overflow") / 10_000;
        require!(self.vault.free.0 >= budget, "vault cannot back this match");
        self.vault.free = U128(sub(self.vault.free.0, budget));
        self.vault.locked = U128(add(self.vault.locked.0, budget));
        emit("open_match", format!(r#"{{"match_id":{},"players":{},"budget":"{budget}"}}"#, j(&match_id), j(&players)));
        let m = Match {
            players,
            stakes: U128(stakes),
            budget: U128(budget),
            status: MatchStatus::Open,
            opened_at: env::block_timestamp(),
            seq: 0,
            head: String::new(),
        };
        self.matches.insert(match_id, m);
    }

    /// Settler, once per match. Exact conservation:
    /// sum(payouts) + vault_repaid + interest_to_vault + reserve == stakes + budget.
    /// The vault is always made whole: a principal shortfall (game bad debt) may only be covered
    /// by the house reserve. The server can always comply by trimming payouts, so a leaked settler
    /// key can never drain LP money, only the stakes of one match.
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        &mut self,
        match_id: String,
        payouts: Vec<(AccountId, U128)>,
        vault_repaid: U128,
        interest_to_vault: U128,
        reserve: U128,
        seq: u64,
        head: String,
    ) {
        self.assert_settler();
        let mut m = self.matches.get(&match_id).cloned().expect("unknown match");
        require!(m.status == MatchStatus::Open, "match is not open");
        require!(payouts.len() <= MAX_PAYOUTS, "too many payouts");
        require!(head.len() <= MAX_HEAD_LEN, "head too long");
        require!(vault_repaid.0 <= m.budget.0, "vault_repaid above budget");
        let paid = payouts.iter().fold(0u128, |s, (_, a)| add(s, a.0));
        let out = add(add(add(paid, vault_repaid.0), interest_to_vault.0), reserve.0);
        require!(out == add(m.stakes.0, m.budget.0), "settle does not conserve value");

        for p in &m.players {
            let t = self.tickets.remove(p).expect("ticket missing");
            require!(t.match_id.as_deref() == Some(match_id.as_str()), "ticket not in this match");
        }
        for (who, amount) in &payouts {
            if amount.0 > 0 {
                self.credit(who, amount.0);
            }
        }

        self.reserve = add(self.reserve, reserve.0);
        let shortfall = sub(m.budget.0, vault_repaid.0);
        require!(shortfall <= self.reserve, "bad debt exceeds reserve: repay the vault from payouts");
        self.reserve -= shortfall;
        self.vault.locked = U128(sub(self.vault.locked.0, m.budget.0));
        self.vault.free = U128(add(add(self.vault.free.0, m.budget.0), interest_to_vault.0));
        if shortfall > 0 {
            emit("bad_debt", format!(r#"{{"match_id":{},"from_reserve":"{shortfall}"}}"#, j(&match_id)));
        }

        m.status = MatchStatus::Settled;
        m.seq = seq;
        m.head = head.clone();
        self.matches.insert(match_id.clone(), m);
        emit("settle", format!(r#"{{"match_id":{},"payouts":{},"seq":{seq},"head":{}}}"#, j(&match_id), j(&payouts), j(&head)));
    }

    /// Player escape hatch: 15 min after entering (or after the match opened, once assigned),
    /// take the stake back. Counting from open stops a losing player from cancelling a live
    /// match with an old ticket. An unsettled match is cancelled and its budget returns.
    pub fn reclaim(&mut self) {
        let player = env::predecessor_account_id();
        let t = self.tickets.get(&player).cloned().expect("no ticket");
        let start = match &t.match_id {
            Some(id) => self.matches.get(id).map_or(t.entered_at, |m| m.opened_at),
            None => t.entered_at,
        };
        let due = start.checked_add(TICKET_DEADLINE_NS).expect("overflow");
        require!(env::block_timestamp() >= due, "ticket deadline not reached");
        if let Some(id) = &t.match_id {
            self.cancel_if_open(id);
        }
        self.refund(&player, t);
    }

    /// Settler: refund a no-show or unassigned ticket, or one whose match was cancelled.
    pub fn refund_ticket(&mut self, account_id: AccountId) {
        self.assert_settler();
        let t = self.tickets.get(&account_id).cloned().expect("no ticket");
        if let Some(id) = &t.match_id {
            let status = self.matches.get(id).map(|m| m.status.clone());
            require!(status == Some(MatchStatus::Cancelled), "ticket is in a live match");
        }
        self.refund(&account_id, t);
    }

    /// Settler: anchor a hash-chain head (paid room progress or the hourly free-match root).
    /// seq must grow, so an anchor can never be rolled back.
    pub fn anchor(&mut self, room_id: String, seq: u64, head: String) {
        self.assert_settler();
        require!(room_id.len() <= MAX_ID_LEN && head.len() <= MAX_HEAD_LEN, "id or head too long");
        if let Some(a) = self.anchors.get(&room_id) {
            require!(seq > a.seq, "anchor seq must increase");
        }
        let a = Anchor { seq, head: head.clone(), at: env::block_timestamp() };
        self.anchors.insert(room_id.clone(), a);
        emit("anchor", format!(r#"{{"room_id":{},"seq":{seq},"head":{}}}"#, j(&room_id), j(&head)));
    }
}

impl Contract {
    fn refund(&mut self, player: &AccountId, t: Ticket) {
        self.tickets.remove(player);
        self.credit(player, t.stake.0);
        emit("refund", format!(r#"{{"account_id":{},"stake":"{}"}}"#, j(player), t.stake.0));
    }

    fn cancel_if_open(&mut self, match_id: &str) {
        let Some(m) = self.matches.get_mut(match_id) else { return };
        if m.status != MatchStatus::Open {
            return;
        }
        m.status = MatchStatus::Cancelled;
        let budget = m.budget.0;
        self.vault.locked = U128(sub(self.vault.locked.0, budget));
        self.vault.free = U128(add(self.vault.free.0, budget));
        emit("cancel", format!(r#"{{"match_id":{}}}"#, j(&match_id)));
    }
}

#[cfg(test)]
mod tests {
    use crate::test_utils::*;
    use crate::*;

    const USDC: u128 = 1_000_000;

    /// Vault 10 USDC; a and b deposit 2 USDC each and enter.
    fn two_players() -> Contract {
        let mut c = setup();
        c.vault.free = U128(10 * USDC);
        c.credit(&acc("a.near"), 2 * USDC);
        c.credit(&acc("b.near"), 2 * USDC);
        for p in ["a.near", "b.near"] {
            ctx(p, 0, 0);
            c.enter_arena(U128(USDC));
        }
        c
    }

    fn open(c: &mut Contract) {
        ctx("settler.near", 0, 1);
        c.open_match("m1".into(), vec![acc("a.near"), acc("b.near")]);
    }

    /// Stakes 2 + budget 3 = 5 USDC out: a 1.8, b 0.1, vault 3 back, 0.07 interest, 0.03 reserve.
    fn settle_ok(c: &mut Contract) {
        let payouts = vec![(acc("a.near"), U128(1_800_000)), (acc("b.near"), U128(100_000))];
        c.settle("m1".into(), payouts, U128(3 * USDC), U128(70_000), U128(30_000), 9, "h".into());
    }

    #[test]
    fn enter_locks_stake() {
        let c = two_players();
        assert_eq!(c.balance_of(acc("a.near")).0, USDC);
        assert_eq!(c.ticket_of(acc("a.near")).unwrap().stake.0, USDC);
    }

    #[test]
    #[should_panic(expected = "already holding a ticket")]
    fn second_ticket_rejected() {
        let mut c = two_players();
        ctx("a.near", 0, 0);
        c.enter_arena(U128(USDC));
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn enter_without_funds_rejected() {
        let mut c = setup();
        c.credit(&acc("a.near"), USDC / 2);
        ctx("a.near", 0, 0);
        c.enter_arena(U128(USDC));
    }

    #[test]
    fn open_reserves_budget_and_settle_conserves() {
        let mut c = two_players();
        open(&mut c);
        assert_eq!(c.vault().free.0, 7 * USDC);
        assert_eq!(c.vault().locked.0, 3 * USDC);
        settle_ok(&mut c);
        assert_eq!(c.balance_of(acc("a.near")).0, USDC + 1_800_000);
        assert_eq!(c.balance_of(acc("b.near")).0, USDC + 100_000);
        assert_eq!(c.vault().free.0, 10 * USDC + 70_000);
        assert_eq!(c.vault().locked.0, 0);
        assert_eq!(c.reserve().0, 30_000);
        assert!(c.ticket_of(acc("a.near")).is_none());
        let m = c.match_of("m1".into()).unwrap();
        assert_eq!((m.status, m.seq), (MatchStatus::Settled, 9));
    }

    #[test]
    #[should_panic(expected = "does not conserve")]
    fn settle_over_cap_rejected() {
        let mut c = two_players();
        open(&mut c);
        let payouts = vec![(acc("a.near"), U128(1_800_001)), (acc("b.near"), U128(100_000))];
        c.settle("m1".into(), payouts, U128(3 * USDC), U128(70_000), U128(30_000), 9, "h".into());
    }

    #[test]
    #[should_panic(expected = "match is not open")]
    fn settle_twice_rejected() {
        let mut c = two_players();
        open(&mut c);
        settle_ok(&mut c);
        settle_ok(&mut c);
    }

    #[test]
    #[should_panic(expected = "only the settler")]
    fn non_settler_rejected() {
        let mut c = two_players();
        open(&mut c);
        ctx("a.near", 0, 1);
        settle_ok(&mut c);
    }

    #[test]
    #[should_panic(expected = "ticket already assigned")]
    fn duplicate_player_rejected() {
        let mut c = two_players();
        ctx("settler.near", 0, 1);
        c.open_match("m1".into(), vec![acc("a.near"), acc("a.near")]);
    }

    #[test]
    fn bad_debt_taken_from_reserve_first() {
        let mut c = two_players();
        c.reserve = 500_000;
        open(&mut c);
        // Vault gets 2.6 of its 3 back: 0.4 shortfall, all covered by the 0.5 reserve.
        let payouts = vec![(acc("a.near"), U128(2_400_000))];
        c.settle("m1".into(), payouts, U128(2_600_000), U128(0), U128(0), 1, "h".into());
        assert_eq!(c.vault().free.0, 10 * USDC);
        assert_eq!(c.reserve().0, 100_000);
    }

    #[test]
    #[should_panic(expected = "bad debt exceeds reserve")]
    fn settler_cannot_drain_vault() {
        let mut c = two_players();
        open(&mut c);
        let payouts = vec![(acc("a.near"), U128(5 * USDC))];
        c.settle("m1".into(), payouts, U128(0), U128(0), U128(0), 1, "h".into());
    }

    #[test]
    #[should_panic(expected = "deadline not reached")]
    fn old_ticket_cannot_cancel_live_match() {
        let mut c = two_players();
        ctx("settler.near", 0, TICKET_DEADLINE_NS - 60);
        c.open_match("m1".into(), vec![acc("a.near"), acc("b.near")]);
        ctx("a.near", 0, TICKET_DEADLINE_NS + 1);
        c.reclaim();
    }

    #[test]
    #[should_panic(expected = "deadline not reached")]
    fn reclaim_before_deadline_rejected() {
        let mut c = two_players();
        ctx("a.near", 0, TICKET_DEADLINE_NS - 1);
        c.reclaim();
    }

    #[test]
    fn reclaim_after_deadline_cancels_and_refunds() {
        let mut c = two_players();
        open(&mut c);
        ctx("a.near", 0, TICKET_DEADLINE_NS + 1);
        c.reclaim();
        assert_eq!(c.balance_of(acc("a.near")).0, 2 * USDC);
        assert_eq!(c.vault().free.0, 10 * USDC);
        assert_eq!(c.match_of("m1".into()).unwrap().status, MatchStatus::Cancelled);
        // The settler can now refund b without waiting.
        ctx("settler.near", 0, TICKET_DEADLINE_NS);
        c.refund_ticket(acc("b.near"));
        assert_eq!(c.balance_of(acc("b.near")).0, 2 * USDC);
    }

    #[test]
    #[should_panic(expected = "match is not open")]
    fn settle_after_reclaim_rejected() {
        let mut c = two_players();
        open(&mut c);
        ctx("a.near", 0, TICKET_DEADLINE_NS + 1);
        c.reclaim();
        ctx("settler.near", 0, TICKET_DEADLINE_NS);
        settle_ok(&mut c);
    }

    #[test]
    #[should_panic(expected = "ticket is in a live match")]
    fn settler_cannot_refund_live_ticket() {
        let mut c = two_players();
        open(&mut c);
        c.refund_ticket(acc("a.near"));
    }

    #[test]
    #[should_panic(expected = "anchor seq must increase")]
    fn anchor_cannot_roll_back() {
        let mut c = setup();
        ctx("settler.near", 0, 0);
        c.anchor("free-2026-11-09T01".into(), 5, "h5".into());
        c.anchor("free-2026-11-09T01".into(), 5, "h5b".into());
    }
}
