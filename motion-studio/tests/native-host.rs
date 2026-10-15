//! CHANGE LOG
//! 1 | maintainer@emeraldcoastsystemsgroup.com | Run Motion's exact native migration and SQL through genuine admitted kernel hosts on shared disposable PostgreSQL; identity/grant fixtures are explicit.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | Validate the extraction manifest, persona, native permission bindings and tool schemas through genuine kernel parsers before any database fixture starts.
use async_trait::async_trait;
use control::{
    BudgetSource, ConfirmationToken, Confirmations, Credential, Entry, EntryKind, GrantSource,
    Grants, IdentitySource, Kernel, KernelParts, Outcome, Read, VerifiedClaims, Write,
};
use kernel_types::{
    Capability, Grant, Issuer, MicroUsd, PackageId, PersonState, Principal, PrincipalId,
    PrincipalKind, Refusal, RefusalCode, Subject, TenantId,
};
use observe::Observer;
use packages::CtxHost;
use sdk::{ExecutionSource, Host, MigrationScript, SchemaAction};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    io::{self, BufRead, Write as IoWrite},
    path::Path,
    sync::Arc,
};

#[derive(Debug)]
struct FixtureIdentities(Vec<(String, Principal)>);
#[async_trait]
impl IdentitySource for FixtureIdentities {
    async fn verify(&self, credential: &Credential) -> Result<VerifiedClaims, Refusal> {
        let Credential::Bearer(subject) = credential else {
            return Err(refusal());
        };
        let (_, person) = self
            .0
            .iter()
            .find(|(token, _)| token == subject)
            .ok_or_else(refusal)?;
        Ok(VerifiedClaims {
            subject: person.subject.clone(),
            issuer: person.issuer.clone(),
            display: None,
        })
    }
    async fn principal(&self, claims: &VerifiedClaims) -> Result<Principal, Refusal> {
        self.0
            .iter()
            .find(|(_, p)| p.subject == claims.subject && p.issuer == claims.issuer)
            .map(|(_, p)| p.clone())
            .ok_or_else(refusal)
    }
    fn trusts(&self, issuer: &Issuer) -> bool {
        matches!(
            issuer.as_str(),
            "motion-native-fixture" | "motion-native-other-fixture"
        )
    }
}
fn refusal() -> Refusal {
    Refusal::new(RefusalCode::NoIdentity, "not an explicit fixture identity")
}
#[derive(Debug)]
struct FixtureAuthority;
#[async_trait]
impl GrantSource for FixtureAuthority {
    async fn grants_for(&self, person: &Principal) -> Result<Grants, Refusal> {
        Ok(Grants::resolve([Grant {
            principal: person.id,
            package: PackageId::new("motion-studio"),
            tier: kernel_types::Tier::Editor,
        }]))
    }
    async fn capabilities_for(
        &self,
        _person: &Principal,
        _package: &PackageId,
    ) -> Result<BTreeSet<Capability>, Refusal> {
        Ok(capabilities())
    }
}
#[async_trait]
impl BudgetSource for FixtureAuthority {
    async fn limit_for(&self, _person: &Principal) -> Result<MicroUsd, Refusal> {
        Ok(MicroUsd::from_micros(i64::MAX))
    }
}
#[async_trait]
impl Confirmations for FixtureAuthority {
    async fn issue(&self, _person: &Principal) -> Result<ConfirmationToken, Refusal> {
        Err(refusal())
    }
    async fn spend(&self, _token: &ConfirmationToken, _person: &Principal) -> Result<(), Refusal> {
        Err(refusal())
    }
}
fn capabilities() -> BTreeSet<Capability> {
    [
        Capability::person("store.read"),
        Capability::person("store.write"),
    ]
    .into_iter()
    .collect()
}
fn person(subject: &str, tenant: TenantId) -> Principal {
    Principal {
        id: PrincipalId::generate(),
        kind: PrincipalKind::Person,
        subject: Subject::new(subject),
        issuer: Issuer::new("motion-native-fixture"),
        tenant,
        state: PersonState::Active,
    }
}
fn emit(value: Value) {
    println!("{value}");
    io::stdout().flush().expect("fixture output");
}

async fn serve(dsn: &str) -> Result<(), Box<dyn std::error::Error>> {
    let backend = Arc::new(store::PostgresStore::connect(dsn).await?);
    let tenant = TenantId::generate();
    let mut same_subject = person("alice", tenant);
    same_subject.issuer = Issuer::new("motion-native-other-fixture");
    let principals = vec![person("alice", tenant), person("bob", tenant), same_subject];
    let kernel = Kernel::new(KernelParts {
        store: backend,
        identities: Arc::new(FixtureIdentities(vec![
            ("alice".into(), principals[0].clone()),
            ("bob".into(), principals[1].clone()),
            ("alice-other-issuer".into(), principals[2].clone()),
        ])),
        grants: Arc::new(FixtureAuthority),
        budgets: Arc::new(FixtureAuthority),
        confirmations: Arc::new(FixtureAuthority),
        observer: Arc::new(Observer::new(vec![])),
    });
    let alice_ctx = kernel
        .admit::<Write>(Entry::new(
            EntryKind::Cli,
            Credential::Bearer("alice".into()),
            PackageId::new("motion-studio"),
        ))
        .await?;
    let bob_ctx = kernel
        .admit::<Write>(Entry::new(
            EntryKind::Cli,
            Credential::Bearer("bob".into()),
            PackageId::new("motion-studio"),
        ))
        .await?;
    let reader_ctx = kernel
        .admit::<Read>(Entry::new(
            EntryKind::Cli,
            Credential::Bearer("alice".into()),
            PackageId::new("motion-studio"),
        ))
        .await?;
    let same_subject_ctx = kernel
        .admit::<Write>(Entry::new(
            EntryKind::Cli,
            Credential::Bearer("alice-other-issuer".into()),
            PackageId::new("motion-studio"),
        ))
        .await?;
    let package = PackageId::new("motion-studio");
    let alice = CtxHost::new(&alice_ctx, package.clone(), capabilities(), None);
    let bob = CtxHost::new(&bob_ctx, package.clone(), capabilities(), None);
    let same_subject_host = CtxHost::new(&same_subject_ctx, package.clone(), capabilities(), None);
    let reader = CtxHost::new(
        &reader_ctx,
        package.clone(),
        [Capability::person("store.read")].into_iter().collect(),
        None,
    );
    let other = CtxHost::new(
        &alice_ctx,
        PackageId::new("other-motion-fixture"),
        capabilities(),
        None,
    );
    let root = std::env::var("MOTION_PACKAGE_DIR")?;
    let sql = std::fs::read_to_string(Path::new(&root).join("migrations/native/001-motion.sql"))?;
    let digest = format!("{:x}", Sha256::digest(sql.as_bytes()));
    let scripts = vec![MigrationScript {
        id: "migrations/native/001-motion.sql".into(),
        digest: digest.clone(),
        sql,
    }];
    let source = ExecutionSource {
        package,
        contract_revision: digest,
    };
    emit(json!({"ready":true,"principals":principals}));
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 12 * 1024 * 1024 {
            return Err("fixture packet limit".into());
        }
        let request: Value = serde_json::from_str(&line)?;
        let host: &dyn Host = match request["actor"].as_str() {
            Some("alice") => &alice,
            Some("bob") => &bob,
            Some("reader") => &reader,
            Some("other-package") => &other,
            Some("same-subject") => &same_subject_host,
            _ => {
                emit(json!({"id":request["id"],"err":"unknown fixture identity"}));
                continue;
            }
        };
        let result = match request["op"].as_str() {
            Some("sql") => host.sql_query(request["input"].clone()).await,
            Some("migrate") => {
                host.schema_migrations(&source, &scripts, SchemaAction::Apply)
                    .await
            }
            Some("inspect") => {
                host.schema_migrations(&source, &scripts, SchemaAction::Inspect)
                    .await
            }
            _ => Err(sdk::HostError::Invalid("unknown fixture operation".into())),
        };
        emit(match result {
            Ok(value) => json!({"id":request["id"],"ok":value}),
            Err(error) => json!({"id":request["id"],"err":error.to_string()}),
        });
    }
    drop(alice);
    drop(bob);
    drop(reader);
    drop(other);
    drop(same_subject_host);
    alice_ctx.finish(Outcome::Ok);
    bob_ctx.finish(Outcome::Ok);
    reader_ctx.finish(Outcome::Ok);
    same_subject_ctx.finish(Outcome::Ok);
    Ok(())
}

fn package_contract(path: &Path) -> Result<Value, Box<dyn std::error::Error>> {
    let source = packages::load_app_manifest(path).map_err(io::Error::other)?;
    let manifest = source.to_sdk_manifest().map_err(io::Error::other)?;
    let auth = manifest
        .authorization
        .as_ref()
        .ok_or("Motion must declare its actual catalog")?;
    let mut tools = Vec::new();
    for raw in source.tools.as_deref().unwrap_or_default() {
        let name = raw["name"].as_str().ok_or("named tool required")?;
        let mut contract = packages::ToolContract::new(
            name,
            raw["description"].as_str().unwrap_or_default(),
            raw["inputSchema"].clone(),
        );
        contract.auth_mode = raw["defaultAuthMode"]
            .as_str()
            .ok_or("explicit tool mode required")?
            .into();
        contract.requires_approval = raw["requiresApproval"]
            .as_bool()
            .ok_or("explicit approval flag required")?;
        contract.validate()?;
        if raw["executor"]["executorType"] != "api" {
            return Err("Motion must use original-caller route tools".into());
        }
        let endpoint = raw["executor"]["apiEndpoint"]
            .as_str()
            .ok_or("route endpoint required")?;
        let (method, target) = endpoint.split_once(' ').ok_or("route method required")?;
        let target = target
            .replace("{input.id}", "10000000-0000-4000-8000-000000000001")
            .replace("{input.revision}", "1");
        let permissions = packages::tool_route_permissions(auth, name, method, &target);
        tools.push(json!({"name":name,"method":method,"path":target,"bound":permissions.is_some(),
            "permissions":permissions,"approvalRequired":contract.approval_required(),
            "mutating":permissions.is_some_and(|names| names.iter().any(|name|
                auth.catalog.permissions[name].effect.minimum_tier() > kernel_types::Tier::Viewer))}));
    }
    Ok(
        json!({"name":manifest.name,"runtime":manifest.runtime,"authorization":auth,
        "tools":tools,"bots":manifest.bots,"uses":manifest.uses,"routes":manifest.routes,
        "migrations":manifest.migrations}),
    )
}
fn validate_tool_input(
    path: &Path,
    name: &str,
    input: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    let source = packages::load_app_manifest(path).map_err(io::Error::other)?;
    let raw = source
        .tools
        .iter()
        .flatten()
        .find(|raw| raw["name"] == name)
        .ok_or("unknown declared tool")?;
    let contract =
        packages::ToolContract::new(name, "fixture validation", raw["inputSchema"].clone());
    let input: Value = serde_json::from_str(input)?;
    contract.validate_input(&input)?;
    Ok(json!({"valid":true}))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|mode| mode == "--package-contract") {
        emit(package_contract(Path::new(
            args.get(2).ok_or("package path required")?,
        ))?);
        return Ok(());
    }
    if args.get(1).is_some_and(|mode| mode == "--http-permissions") {
        let source =
            packages::load_app_manifest(Path::new(args.get(2).ok_or("package path required")?))
                .map_err(io::Error::other)?;
        let manifest = source.to_sdk_manifest().map_err(io::Error::other)?;
        let auth = manifest.authorization.as_ref().ok_or("catalog required")?;
        emit(
            json!({"permissions":auth.http_permissions(args.get(3).ok_or("method required")?, args.get(4).ok_or("path required")?)}),
        );
        return Ok(());
    }
    if args.get(1).is_some_and(|mode| mode == "--tool-input") {
        emit(validate_tool_input(
            Path::new(args.get(2).ok_or("package path required")?),
            args.get(3).ok_or("tool name required")?,
            args.get(4).ok_or("input JSON required")?,
        )?);
        return Ok(());
    }
    // Before connecting, require the one explicitly authorized disposable server.
    let file = std::env::var("MOTION_TEST_DSN_FILE")?;
    let raw = std::fs::read_to_string(file)?;
    let mut config: tokio_postgres::Config = raw.trim().parse()?;
    if config.get_ports() != [35689]
        || config.get_hosts().len() != 1
        || !matches!(&config.get_hosts()[0], tokio_postgres::config::Host::Tcp(host) if host == "127.0.0.1")
    {
        return Err("shared disposable PG127.0.0.1:35689 required".into());
    }
    let db = std::env::var("MOTION_NATIVE_DATABASE")?;
    if db.len() != 46
        || !db.starts_with("motion_native_")
        || !db[14..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("invalid fixture database".into());
    }
    let (admin, driver) = config.connect(tokio_postgres::NoTls).await?;
    tokio::spawn(async move {
        let _ = driver.await;
    });
    admin
        .batch_execute(&format!("CREATE DATABASE {db}"))
        .await?;
    config.dbname(&db);
    // Convert only the validated config; avoid exposing credentials in logs/errors.
    let (probe, driver) = config.connect(tokio_postgres::NoTls).await?;
    tokio::spawn(async move {
        let _ = driver.await;
    });
    drop(probe);
    // PostgresStore accepts URI/keyword DSNs. Append a dbname keyword to the
    // already parsed config through a URI constructed by the Node fixture instead.
    let fixture_dsn = std::env::var("MOTION_NATIVE_DSN")?;
    let checked: tokio_postgres::Config = fixture_dsn.parse()?;
    if checked.get_dbname() != Some(db.as_str())
        || checked.get_hosts() != config.get_hosts()
        || checked.get_ports() != config.get_ports()
        || checked.get_user() != config.get_user()
        || checked.get_password() != config.get_password()
    {
        return Err("fixture connection mismatch".into());
    }
    let result = serve(&fixture_dsn).await;
    let cleanup = admin
        .batch_execute(&format!("DROP DATABASE {db} WITH (FORCE)"))
        .await;
    result?;
    cleanup?;
    Ok(())
}
