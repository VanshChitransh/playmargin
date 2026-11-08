// Sandbox integration tests: real wasm (margin + mock USDC) on a local near-sandbox node.
// One sandbox per test binary run keeps CI under a minute after the first build.

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

        let env = Self { _sandbox: sandbox, net, signer, margin, usdc, fake, owner, alice, bob };
        for t in [env.usdc.clone(), env.fake.clone()] {
            for who in [env.margin.clone(), env.alice.clone(), env.owner.clone()] {
                env.call(&env.owner, &t, "mint", json!({"account_id": who, "amount": "10000000"}), 0, true)
                    .await?;
            }
        }
        Ok(env)
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
