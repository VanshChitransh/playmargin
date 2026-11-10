// Sandbox integration tests: real wasm (margin + mock USDC) on a local near-sandbox node.
// Each test starts its own sandbox; wasm builds are cached by cargo after the first one.

use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

struct Env {
    _sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    margin: AccountId,
    usdc: AccountId,
    fake: AccountId,
    owner: AccountId,
    settler: AccountId,
    alice: AccountId,
    bob: AccountId,
}

fn build(manifest: &str) -> testresult::TestResult<Vec<u8>> {
    let opts = cargo_near_build::BuildOpts {
        manifest_path: Some(manifest.to_string().into()),
        ..Default::default()
    };
    Ok(std::fs::read(cargo_near_build::build_with_cli(opts)?)?)
}

async fn account(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = format!("{name}.sandbox").parse()?;
    sandbox
        .create_account(id.as_str().parse()?)
        .initial_balance(NearToken::from_near(20))
        .send()
        .await?;
    Ok(id)
}

impl Env {
    async fn start() -> testresult::TestResult<Self> {
        let margin_wasm = build("Cargo.toml")?;
        let ft_wasm = build("../mock-usdc/Cargo.toml")?;
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        let owner = account(&sandbox, "owner").await?;
        let settler = account(&sandbox, "settler").await?;
        let alice = account(&sandbox, "alice").await?;
        let bob = account(&sandbox, "bob").await?;
        let margin = account(&sandbox, "margin").await?;
        let usdc = account(&sandbox, "usdc").await?;
        let fake = account(&sandbox, "fake").await?;

        for t in [&usdc, &fake] {
            near_api::Contract::deploy(t.clone())
                .use_code(ft_wasm.clone())
                .with_init_call("new", json!({"owner": owner}))?
                .with_signer(signer.clone())
                .send_to(&net)
                .await?
                .assert_success();
        }
        near_api::Contract::deploy(margin.clone())
            .use_code(margin_wasm)
            .with_init_call("new", json!({"owner": owner, "settler": settler, "usdc": usdc}))?
            .with_signer(signer.clone())
            .send_to(&net)
            .await?
            .assert_success();

        let env = Self { _sandbox: sandbox, net, signer, margin, usdc, fake, owner, settler, alice, bob };
        for t in [env.usdc.clone(), env.fake.clone()] {
            for who in [env.margin.clone(), env.alice.clone(), env.owner.clone()] {
                env.call(&env.owner, &t, "mint", json!({"account_id": who, "amount": "10000000"}), 0, true)
                    .await?;
            }
        }
        Ok(env)
    }

    fn sandbox(&self) -> &near_sandbox::Sandbox {
        &self._sandbox
    }

    async fn call(
        &self,
        from: &AccountId,
        to: &AccountId,
        method: &str,
        args: Value,
        yocto: u128,
        ok: bool,
    ) -> testresult::TestResult<()> {
        let r = near_api::Contract(to.clone())
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(150))
            .deposit(NearToken::from_yoctonear(yocto))
            .with_signer(from.clone(), self.signer.clone())
            .send_to(&self.net)
            .await?;
        if ok {
            r.assert_success();
        } else {
            r.assert_failure();
        }
        Ok(())
    }

    async fn view(&self, on: &AccountId, method: &str, args: Value) -> testresult::TestResult<Value> {
        Ok(near_api::Contract(on.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
    }

    async fn ft_balance(&self, token: &AccountId, who: &AccountId) -> testresult::TestResult<String> {
        let v = self.view(token, "ft_balance_of", json!({"account_id": who})).await?;
        Ok(v.as_str().unwrap_or_default().to_string())
    }

    async fn margin_balance(&self, who: &AccountId) -> testresult::TestResult<String> {
        let v = self.view(&self.margin, "balance_of", json!({"account_id": who})).await?;
        Ok(v.as_str().unwrap_or_default().to_string())
    }

    /// ft_transfer_call of `amount` from `from` into margin with `msg`.
    async fn deposit(&self, token: &AccountId, from: &AccountId, amount: &str, msg: &str) -> testresult::TestResult<()> {
        let args = json!({"receiver_id": self.margin, "amount": amount, "msg": msg});
        self.call(from, token, "ft_transfer_call", args, 1, true).await?;
        Ok(())
    }
}

#[tokio::test]
async fn deposits() -> testresult::TestResult<()> {
    let e = Env::start().await?;

    // Empty msg credits the sender; {"for"} credits someone else (the Intents delivery path).
    e.deposit(&e.usdc, &e.alice, "1000000", "").await?;
    e.deposit(&e.usdc, &e.alice, "2000000", &json!({"for": e.bob}).to_string()).await?;
    assert_eq!(e.margin_balance(&e.alice).await?, "1000000");
    assert_eq!(e.margin_balance(&e.bob).await?, "2000000");
    assert_eq!(e.ft_balance(&e.usdc, &e.alice).await?, "7000000");

    // Bad msg: full refund, nothing credited.
    e.deposit(&e.usdc, &e.alice, "1000000", "not json").await?;
    assert_eq!(e.ft_balance(&e.usdc, &e.alice).await?, "7000000");
    assert_eq!(e.margin_balance(&e.alice).await?, "1000000");

    // Wrong token: margin panics, the token's resolve refunds the sender.
    e.deposit(&e.fake, &e.alice, "1000000", "").await?;
    assert_eq!(e.ft_balance(&e.fake, &e.alice).await?, "10000000");
    assert_eq!(e.margin_balance(&e.alice).await?, "1000000");

    // Owner seeds the vault.
    e.deposit(&e.usdc, &e.owner, "5000000", r#"{"vault":true}"#).await?;
    let vault = e.view(&e.margin, "vault", json!({})).await?;
    assert_eq!(vault["free"], "5000000");
    Ok(())
}

/// Paid match money flow plus every rejection the contract must enforce (DEVELOPMENT.md N3).
#[tokio::test]
async fn arena_lifecycle() -> testresult::TestResult<()> {
    let e = Env::start().await?;
    let (a, b, s, m) = (e.alice.clone(), e.bob.clone(), e.settler.clone(), e.margin.clone());
    e.deposit(&e.usdc, &e.owner, "5000000", r#"{"vault":true}"#).await?;
    e.deposit(&e.usdc, &a, "2000000", "").await?;
    e.deposit(&e.usdc, &a, "2000000", &json!({"for": b}).to_string()).await?;

    // Enter locks the stake.
    for p in [&a, &b] {
        e.call(p, &m, "enter_arena", json!({"stake": "1000000"}), 0, true).await?;
    }
    assert_eq!(e.margin_balance(&a).await?, "1000000");
    e.call(&a, &m, "enter_arena", json!({"stake": "1000000"}), 0, false).await?;

    // Open: budget 1.5 x 2 USDC reserved from the vault.
    let open = json!({"match_id": "m1", "players": [a, b]});
    e.call(&a, &m, "open_match", open.clone(), 0, false).await?;
    e.call(&s, &m, "open_match", open, 0, true).await?;
    assert_eq!(e.view(&m, "vault", json!({})).await?["locked"], "3000000");

    let settle = |pay_a: &str| {
        json!({"match_id": "m1", "payouts": [[a, pay_a], [b, "100000"]], "lent": "1000000",
               "vault_repaid": "1000000", "interest_to_vault": "50000", "fees": "20000",
               "reserve": "30000", "seq": 7, "head": "abc"})
    };
    e.call(&s, &m, "settle", settle("1800001"), 0, false).await?; // over cap
    e.call(&a, &m, "settle", settle("1800000"), 0, false).await?; // not the settler
    e.call(&s, &m, "settle", settle("1800000"), 0, true).await?;
    e.call(&s, &m, "settle", settle("1800000"), 0, false).await?; // twice
    assert_eq!(e.margin_balance(&a).await?, "2800000");
    assert_eq!(e.view(&m, "vault", json!({})).await?["free"], "5070000");
    assert_eq!(e.view(&m, "match_of", json!({"match_id": "m1"})).await?["head"], "abc");

    // Withdraw: needs 1 yocto; bob is not registered on USDC so the transfer fails and re-credits.
    e.call(&a, &m, "withdraw", json!({"amount": "800000"}), 0, false).await?;
    e.call(&a, &m, "withdraw", json!({"amount": "800000"}), 1, true).await?;
    assert_eq!(e.ft_balance(&e.usdc, &a).await?, "6800000");
    assert_eq!(e.margin_balance(&a).await?, "2000000");
    e.call(&b, &m, "withdraw", json!({"amount": "100000"}), 1, true).await?;
    assert_eq!(e.margin_balance(&b).await?, "1100000");

    // The callback cannot be called from outside.
    let cb = json!({"account_id": a, "amount": "1000000"});
    e.call(&a, &m, "on_withdraw", cb, 0, false).await?;
    assert_eq!(e.margin_balance(&a).await?, "2000000");

    // Revolving budget: repay then BOOST again, lifetime lent 4 > budget 3 is valid, but
    // outstanding debt (lent - repaid) above the budget is refused.
    for p in [&a, &b] {
        e.call(p, &m, "enter_arena", json!({"stake": "1000000"}), 0, true).await?;
    }
    e.call(&s, &m, "open_match", json!({"match_id": "m3", "players": [a, b]}), 0, true).await?;
    let revolve = |lent: &str, pay_a: &str| {
        json!({"match_id": "m3", "payouts": [[a, pay_a], [b, "100000"]], "lent": lent,
               "vault_repaid": "4000000", "interest_to_vault": "50000", "fees": "20000",
               "reserve": "30000", "seq": 3, "head": "rev"})
    };
    e.call(&s, &m, "settle", revolve("7000001", "4800001"), 0, false).await?; // outstanding 3.000001
    e.call(&s, &m, "settle", revolve("4000000", "1800000"), 0, true).await?;
    assert_eq!(e.margin_balance(&a).await?, "2800000");
    assert_eq!(e.view(&m, "vault", json!({})).await?["free"], "5140000");
    assert_eq!(e.view(&m, "vault", json!({})).await?["locked"], "0");

    // Nobody survives: no payouts, the leftover pot goes to the vault (Vansh, 9 Nov).
    // Stakes 2 + lent 1 = repaid 1 + leftover 1.9 to vault + fees 0.05 + reserve 0.05.
    e.deposit(&e.usdc, &a, "1000000", &json!({"for": b}).to_string()).await?;
    for p in [&a, &b] {
        e.call(p, &m, "enter_arena", json!({"stake": "1000000"}), 0, true).await?;
    }
    e.call(&s, &m, "open_match", json!({"match_id": "m4", "players": [a, b]}), 0, true).await?;
    let wipe = json!({"match_id": "m4", "payouts": [], "lent": "1000000", "vault_repaid": "1000000",
                      "interest_to_vault": "1900000", "fees": "50000", "reserve": "50000",
                      "seq": 4, "head": "wipe"});
    e.call(&s, &m, "settle", wipe, 0, true).await?;
    assert_eq!(e.view(&m, "vault", json!({})).await?["free"], "7090000");
    assert_eq!(e.margin_balance(&a).await?, "1800000");

    // A7: a registered house agent (liquidator drone) can be paid its bounty, capped at 12% of
    // the stakes (0.24 USDC here). The fake-token account stands in for drone-1.
    let d = e.fake.clone();
    e.deposit(&e.usdc, &a, "1000000", &json!({"for": b}).to_string()).await?;
    for p in [&a, &b] {
        e.call(p, &m, "enter_arena", json!({"stake": "1000000"}), 0, true).await?;
    }
    e.call(&s, &m, "open_match", json!({"match_id": "m5", "players": [a, b]}), 0, true).await?;
    let bounty = |pay_a: &str, pay_d: &str| {
        json!({"match_id": "m5", "payouts": [[a, pay_a], [b, "100000"], [d, pay_d]], "lent": "1000000",
               "vault_repaid": "1000000", "interest_to_vault": "50000", "fees": "20000",
               "reserve": "30000", "seq": 5, "head": "bounty"})
    };
    e.call(&s, &m, "settle", bounty("1700000", "100000"), 0, false).await?; // not an agent yet
    let reg = json!({"add": [d], "remove": []});
    e.call(&a, &m, "set_agents", reg.clone(), 1, false).await?; // not the owner
    e.call(&e.owner, &m, "set_agents", reg, 1, true).await?;
    assert_eq!(e.view(&m, "is_agent", json!({"account_id": d})).await?, true);
    e.call(&s, &m, "settle", bounty("1559999", "240001"), 0, false).await?; // over the 12% cap
    e.call(&s, &m, "settle", bounty("1700000", "100000"), 0, true).await?;
    assert_eq!(e.margin_balance(&d).await?, "100000");

    // Bell bonus cap (core PR #20): survivors split the leftover food, each capped at 50% of
    // their own bell equity. Equities 1.0 and 0.3, leftover 0.7, so each = 0.35 and b is capped
    // at 0.15. The capped 0.2 rides in interest_to_vault like the no-survivor leftover, so the
    // contract needs no change: a 1.35, b 0.45, vault +0.2, total = stakes 2.0.
    e.deposit(&e.usdc, &a, "1000000", &json!({"for": b}).to_string()).await?;
    let (a0, b0) = (e.margin_balance(&a).await?, e.margin_balance(&b).await?);
    let free0 = e.view(&m, "vault", json!({})).await?["free"].as_str().unwrap_or_default().parse::<u128>()?;
    for p in [&a, &b] {
        e.call(p, &m, "enter_arena", json!({"stake": "1000000"}), 0, true).await?;
    }
    e.call(&s, &m, "open_match", json!({"match_id": "m6", "players": [a, b]}), 0, true).await?;
    let bell = json!({"match_id": "m6", "payouts": [[a, "1350000"], [b, "450000"]], "lent": "0",
                      "vault_repaid": "0", "interest_to_vault": "200000", "fees": "0", "reserve": "0",
                      "seq": 6, "head": "bell"});
    e.call(&s, &m, "settle", bell, 0, true).await?;
    let gain = |before: &str, after: String| after.parse::<i128>().unwrap() - before.parse::<i128>().unwrap();
    assert_eq!(gain(&a0, e.margin_balance(&a).await?), 350_000); // -1.0 stake + 1.35
    assert_eq!(gain(&b0, e.margin_balance(&b).await?), -550_000); // -1.0 stake + 0.45
    assert_eq!(e.view(&m, "vault", json!({})).await?["free"], (free0 + 200_000).to_string());
    assert_eq!(e.view(&m, "vault", json!({})).await?["locked"], "0");
    Ok(())
}

/// A match the server never settles: players reclaim after the deadline, settle is then refused.
#[tokio::test]
async fn reclaim_stuck_match() -> testresult::TestResult<()> {
    let e = Env::start().await?;
    let (a, s, m) = (e.alice.clone(), e.settler.clone(), e.margin.clone());
    e.deposit(&e.usdc, &e.owner, "5000000", r#"{"vault":true}"#).await?;
    e.deposit(&e.usdc, &a, "1000000", "").await?;
    e.call(&a, &m, "enter_arena", json!({"stake": "1000000"}), 0, true).await?;
    e.call(&s, &m, "open_match", json!({"match_id": "m2", "players": [a]}), 0, true).await?;

    e.call(&a, &m, "reclaim", json!({}), 0, false).await?; // before the 15 min deadline
    // Sandbox blocks are ~100 ms apart, so 12k blocks clears the 15 min deadline.
    e.sandbox().fast_forward(12_000).await?;
    e.call(&a, &m, "reclaim", json!({}), 0, true).await?;
    assert_eq!(e.margin_balance(&a).await?, "1000000");
    assert_eq!(e.view(&m, "vault", json!({})).await?["free"], "5000000");

    let settle = json!({"match_id": "m2", "payouts": [[a, "2500000"]], "lent": "1500000",
                        "vault_repaid": "1500000", "interest_to_vault": "0", "fees": "0", "reserve": "0",
                        "seq": 1, "head": "x"});
    e.call(&s, &m, "settle", settle, 0, false).await?;
    Ok(())
}
