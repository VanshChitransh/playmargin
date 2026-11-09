// Paid-match lifecycle: enter (ticket) -> open_match (assign + reserve vault budget) -> settle.
// Settle and reclaim both consume tickets inside one receipt, so exactly one of them wins
// (EDGE-CASES NS-12). No global heartbeat: every ticket carries its own 15 min deadline.

use crate::*;

#[near]
impl Contract {
    /// Moves the entry stake from the caller's balance into a ticket. Callable with a session
    /// (function-call) key: no deposit needed, and it can never move money out of the contract.
    pub fn enter_arena(&mut self, stake: U128) {
        let player = env::predecessor_account_id();
        require!(stake.0 == self.entry_stake, "stake must equal the entry stake (see config)");
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

    /// Settler, once per match. Mirrors core settle() (packages/core/src/settle.ts):
    /// sum(payouts) + vault_repaid + interest_to_vault + fees + reserve == stakes + lent,
    /// with vault_repaid <= lent and outstanding debt (lent - vault_repaid) <= budget. The budget
    /// revolves: players repay then BOOST again, so lifetime lent may exceed it. The vault always
    /// gets back its whole budget
    /// plus interest and fees: bad debt (lent - vault_repaid) may only come from the house
    /// reserve, so a leaked settler key can never drain LP money, only one match's stakes.
    /// The server can always comply by trimming payouts.
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        &mut self,
        match_id: String,
        payouts: Vec<(AccountId, U128)>,
        lent: U128,
        vault_repaid: U128,
        interest_to_vault: U128,
        fees: U128,
        reserve: U128,
        seq: u64,
        head: String,
    ) {
        self.assert_settler();
        let mut m = self.matches.get(&match_id).cloned().expect("unknown match");
        require!(m.status == MatchStatus::Open, "match is not open");
        require!(payouts.len() <= MAX_PAYOUTS, "too many payouts");
        require!(head.len() <= MAX_HEAD_LEN, "head too long");
        require!(vault_repaid.0 <= lent.0, "vault_repaid above lent");
        require!(lent.0 - vault_repaid.0 <= m.budget.0, "outstanding debt above the budget reserved at open");
        let paid = payouts.iter().fold(0u128, |s, (_, a)| add(s, a.0));
        for (who, _) in &payouts {
            require!(m.players.contains(who), "payout to an account not in the match");
        }
        let out = [vault_repaid.0, interest_to_vault.0, fees.0, reserve.0].into_iter().fold(paid, add);
        require!(out == add(m.stakes.0, lent.0), "settle does not conserve value");

        for p in &m.players {
            let t = self.tickets.remove(p).expect("ticket missing");
            require!(t.match_id.as_deref() == Some(match_id.as_str()), "ticket not in this match");
        }
        for (who, amount) in &payouts {
            if amount.0 > 0 {
                self.credit(who, amount.0);
            }
        }

        let bad_debt = lent.0 - vault_repaid.0;
        require!(bad_debt <= m.budget.0 * BAD_DEBT_MAX_BPS / 10_000, "bad debt above 10% of the budget");
        self.reserve = add(self.reserve, reserve.0);
        require!(bad_debt <= self.reserve, "bad debt exceeds reserve: repay the vault from payouts");
        self.reserve -= bad_debt;
        let back = [interest_to_vault.0, fees.0].into_iter().fold(m.budget.0, add);
        self.vault.locked = U128(sub(self.vault.locked.0, m.budget.0));
        self.vault.free = U128(add(self.vault.free.0, back));
        if bad_debt > 0 {
            emit("bad_debt", format!(r#"{{"match_id":{},"from_reserve":"{bad_debt}"}}"#, j(&match_id)));
        }

        m.status = MatchStatus::Settled;
        m.players = Vec::new(); // tombstone: the settle event keeps the list (N11 M1)
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
        require!(room_id == ANCHOR_ROOM, "only the free-match anchor");
        require!(head.len() <= MAX_HEAD_LEN, "head too long");
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
        m.players = Vec::new(); // tickets still name the match, reclaim and refund need nothing else
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

    /// settle(match, payouts, lent, vault_repaid, interest, fees, reserve) with seq 9, head "h".
    fn st(c: &mut Contract, payouts: Vec<(&str, u128)>, n: [u128; 5]) {
        let p = payouts.into_iter().map(|(a, v)| (acc(a), U128(v))).collect();
        let [lent, rep, int, fee, res] = n.map(U128);
        c.settle("m1".into(), p, lent, rep, int, fee, res, 9, "h".into());
    }

    /// Stakes 2 + lent 1 = 3 USDC out: a 1.8, b 0.1, vault repaid 1, interest 0.05, fees 0.02,
    /// reserve 0.03. Vault ends with its 3 budget + 0.07.
    fn settle_ok(c: &mut Contract) {
        st(c, vec![("a.near", 1_800_000), ("b.near", 100_000)], [USDC, USDC, 50_000, 20_000, 30_000]);
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
        st(&mut c, vec![("a.near", 1_800_001), ("b.near", 100_000)], [USDC, USDC, 50_000, 20_000, 30_000]);
    }

    /// Mainnet may launch at 0.10 USDC: the stake is state, checked against config.
    #[test]
    fn cheap_entry_stake() {
        let mut c = setup();
        ctx("owner.near", 1, 0);
        c.set_entry_stake(U128(100_000));
        assert_eq!(c.config().entry_stake.0, 100_000);
        c.credit(&acc("a.near"), USDC);
        ctx("a.near", 0, 0);
        c.enter_arena(U128(100_000));
        assert_eq!(c.balance_of(acc("a.near")).0, 900_000);
    }

    #[test]
    #[should_panic(expected = "stake must equal the entry stake")]
    fn old_stake_refused_after_change() {
        let mut c = setup();
        ctx("owner.near", 1, 0);
        c.set_entry_stake(U128(100_000));
        c.credit(&acc("a.near"), USDC);
        ctx("a.near", 0, 0);
        c.enter_arena(U128(USDC));
    }

    #[test]
    #[should_panic(expected = "exactly 1 yoctoNEAR")]
    fn entry_stake_change_needs_yocto() {
        let mut c = setup();
        ctx("owner.near", 0, 0);
        c.set_entry_stake(U128(100_000));
    }

    /// Upgrade path: V1 state (no entry_stake) on disk, migrate keeps balances and adds the stake.
    #[test]
    fn migrate_from_v1() {
        let mut c = setup();
        c.credit(&acc("a.near"), 3 * USDC);
        c.balances.flush();
        let v1 = ContractV1 {
            owner: acc("owner.near"),
            settler: acc("settler.near"),
            usdc: acc("usdc.near"),
            balances: LookupMap::new(Key::Balances),
            tickets: LookupMap::new(Key::Tickets),
            matches: LookupMap::new(Key::Matches),
            anchors: LookupMap::new(Key::Anchors),
            vault: Vault { free: U128(7), locked: U128(0) },
            reserve: 5,
        };
        env::state_write(&v1);
        ctx("margin.near", 0, 0);
        let m = Contract::migrate(Some(U128(100_000)));
        assert_eq!(m.balance_of(acc("a.near")).0, 3 * USDC);
        assert_eq!(m.reserve().0, 5);
        assert_eq!(m.config().entry_stake.0, 100_000);
    }

    #[test]
    #[should_panic(expected = "outstanding debt above the budget")]
    fn outstanding_over_budget_rejected() {
        let mut c = two_players();
        open(&mut c);
        st(&mut c, vec![("a.near", 5 * USDC + 1)], [3 * USDC + 1, 0, 0, 0, 0]);
    }

    /// Revolving budget (S1 demo: lent 1097 vs budget 900): lent 4 > budget 3, all repaid, valid.
    #[test]
    fn revolving_budget_settles() {
        let mut c = two_players();
        open(&mut c);
        st(&mut c, vec![("a.near", 1_800_000), ("b.near", 100_000)], [4 * USDC, 4 * USDC, 50_000, 20_000, 30_000]);
        assert_eq!(c.balance_of(acc("a.near")).0, 1_800_000 + USDC);
        assert_eq!(c.vault().locked.0, 0);
    }

    #[test]
    #[should_panic(expected = "vault_repaid above lent")]
    fn repaid_over_lent_rejected() {
        let mut c = two_players();
        open(&mut c);
        st(&mut c, vec![("a.near", USDC)], [USDC, 2 * USDC, 0, 0, 0]);
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
        // Lent 1, repaid 0.75: 0.25 bad debt (cap 10% of the 3 budget), covered by the 0.5 reserve.
        st(&mut c, vec![("a.near", 2_250_000)], [USDC, 750_000, 0, 0, 0]);
        assert_eq!(c.vault().free.0, 10 * USDC);
        assert_eq!(c.reserve().0, 250_000);
    }

    #[test]
    #[should_panic(expected = "bad debt exceeds reserve")]
    fn reserve_must_cover_bad_debt() {
        let mut c = two_players();
        open(&mut c);
        st(&mut c, vec![("a.near", 2_200_000)], [USDC, 800_000, 0, 0, 0]);
    }

    /// N11 H2: a leaked settler key cannot pay an outsider, nor push more than 10% bad debt.
    #[test]
    #[should_panic(expected = "not in the match")]
    fn payout_to_outsider_rejected() {
        let mut c = two_players();
        open(&mut c);
        st(&mut c, vec![("thief.near", 1_800_000), ("b.near", 100_000)], [USDC, USDC, 50_000, 20_000, 30_000]);
    }

    #[test]
    fn settle_tombstones_match() {
        let mut c = two_players();
        open(&mut c);
        settle_ok(&mut c);
        assert!(c.match_of("m1".into()).unwrap().players.is_empty());
    }

    #[test]
    #[should_panic(expected = "only the free-match anchor")]
    fn anchor_other_room_rejected() {
        let mut c = setup();
        ctx("settler.near", 0, 0);
        c.anchor("spam-1".into(), 1, "h".into());
    }

    #[test]
    #[should_panic(expected = "bad debt above")]
    fn settler_cannot_drain_vault() {
        let mut c = two_players();
        open(&mut c);
        st(&mut c, vec![("a.near", 5 * USDC)], [3 * USDC, 0, 0, 0, 0]);
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
        c.anchor("free".into(), 5, "h5".into());
        c.anchor("free".into(), 5, "h5b".into());
    }
}
