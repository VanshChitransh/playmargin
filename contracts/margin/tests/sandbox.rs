// Sandbox integration tests: real wasm on a local near-sandbox node.
// The build runs once per test binary via cargo-near-build, so keep cases in one async flow.

use near_api::{AccountId, NearToken};
use near_sdk::serde_json::{Value, json};

async fn create_account(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox
        .create_account(id.as_str().parse()?)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(id)
}

#[tokio::test]
async fn deploys_and_inits() -> testresult::TestResult<()> {
    let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let contract = create_account(&sandbox, "margin.sandbox").await?;
    near_api::Contract::deploy(contract.clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({"owner": "owner.sandbox", "settler": "settler.sandbox", "usdc": "usdc.sandbox"}),
        )?
        .with_signer(signer)
        .send_to(&net)
        .await?
        .assert_success();

    let cfg: Value = near_api::Contract(contract)
        .call_function("config", ())
        .read_only()
        .fetch_from(&net)
        .await?
        .data;
    assert_eq!(cfg["settler"], "settler.sandbox");
    Ok(())
}
