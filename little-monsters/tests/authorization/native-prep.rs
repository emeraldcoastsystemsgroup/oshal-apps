//! CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise shipped prep routes and migrations on an isolated native installation.
//! 2 | maintainer@emeraldcoastsystemsgroup.com | Lesson videos stream through the package's real media route from lasting storage: exact bytes above the 8 MiB package reply limit and a real byte range.
#![cfg(target_os = "linux")]
use axum::{body::Body, http::Request};
use control::{Credential, DataScope, Entry, EntryKind, Outcome, Statement, Write};
use http_body_util::BodyExt;
use kernel_types::{BrainRecord, BrainRung, Capability, ModelId, PackageId, PrincipalId, ProviderId, Tier};
use inference::Provider;
use std::sync::{Arc,Mutex};
use std::collections::VecDeque;
use oshald::{config::Config, Installation};
use packages::CtxHost;
use sdk::Host;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tower::ServiceExt;
const SCHOOL: &str = "00000000-0000-4000-8000-00000000d001";
struct Fixture { root: PathBuf }
fn copy_tree(source: &Path, target: &Path) {
    std::fs::create_dir_all(target).unwrap();
    for entry in std::fs::read_dir(source).unwrap() {
        let entry = entry.unwrap(); let dest = target.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() { copy_tree(&entry.path(), &dest); }
        else { std::fs::copy(entry.path(), dest).unwrap(); }
    }
}
impl Fixture {
    fn new() -> Self {
        let source = PathBuf::from(std::env::var_os("OSHAL_LM_PACKAGE_SOURCE").expect("package source"));
        let root = std::env::temp_dir().join(format!("lm-native-prep-{}", PrincipalId::generate()));
        let app = root.join("apps/little-monsters");
        copy_tree(&source.join("routes"), &app.join("routes"));
        copy_tree(&source.join("personas"), &app.join("personas"));
        // Same production adapter and router; other classroom surfaces need unrelated office runtimes.
        std::fs::write(app.join("routes/fixture.js"),"exports.createFixtureRoutes = ctx => {const express=require('express'); require('./education-authorization').registerEducationAuthorization(ctx);const router=express.Router();router.get('/prep-media/:file',require('./education-prep-media').createPrepMediaHandler(require('path').join(ctx.appPackageDir,'tools/prep-media')));router.use(require('./education-prep-routes').createEducationPrepRoutes(ctx));return router;};").unwrap();
        std::fs::create_dir_all(app.join("tools/prep-media")).unwrap();
        for file in ["linear.jpg","linear.vtt","manifest.json"] {let file=file.to_owned();std::fs::copy(source.join("tools/prep-media").join(&file),app.join("tools/prep-media").join(file)).unwrap();}
        std::fs::create_dir_all(app.join("data/test-prep")).unwrap();
        for file in ["catalog.json", "strategies.json", "official-resources.json"] {
            std::fs::copy(source.join("data/test-prep").join(file), app.join("data/test-prep").join(file)).unwrap();
        }
        copy_tree(&source.join("storage"), &app.join("storage"));
        std::fs::copy(source.join("authorization.yaml"),app.join("authorization.yaml")).unwrap();
        let manifest: Value=serde_yaml::from_str(&std::fs::read_to_string(source.join("oshal-app.yaml")).unwrap()).unwrap();
        let tools: Vec<_>=manifest["tools"].as_array().unwrap().iter().filter(|t|t["name"].as_str().unwrap_or("").starts_with("lm-test-prep-")).cloned().collect();
        std::fs::create_dir_all(app.join("migrations")).unwrap();
        let base = "CREATE TABLE lm_tenants(tenant_id UUID PRIMARY KEY); CREATE TABLE lm_students(student_id UUID PRIMARY KEY,name TEXT,email TEXT,role TEXT,external_issuer TEXT,external_id TEXT,tenant_id UUID); CREATE TABLE lm_classes(class_id UUID PRIMARY KEY,teacher_student_id UUID,tenant_id UUID); CREATE TABLE lm_enrollments(student_id UUID,class_id UUID);";
        std::fs::write(app.join("migrations/fixture.sql"), base).unwrap();
        let mut migrations = vec!["migrations/fixture.sql".to_owned()];
        for file in ["039-test-prep.sql", "040-test-prep-records.sql", "041-test-prep-bank.sql"] {
            std::fs::copy(source.join("migrations").join(file), app.join("migrations").join(file)).unwrap();
            migrations.push(format!("migrations/{file}"));
        }
        std::fs::write(app.join("oshal-app.yaml"), json!({"name":"little-monsters","version":"1.7.0","lastingStorage":true,
            "uses":["store.read","store.write","application-authorization"],"migrations":migrations,"tools":tools,"bots":[manifest["bots"].as_array().unwrap().iter().find(|b|b["name"]=="test-prep-coach").unwrap()],"authorization":{"version":1,"catalog":"authorization.yaml"},
            "routes":[{"module":"routes/fixture.js","factory":"createFixtureRoutes","mountPath":"/api/education"}]}).to_string()).unwrap();
        packages::load_app_manifest(&app.join("oshal-app.yaml")).expect("fixture manifest parses").to_sdk_manifest().expect("fixture manifest validates");
        let media: Value=serde_json::from_slice(&std::fs::read(source.join("tools/prep-media/manifest.json")).unwrap()).unwrap();
        let kept=root.join("package-data/little-monsters/prep-media");
        std::fs::create_dir_all(&kept).unwrap();
        std::fs::copy(source.join(".videos/linear.mp4"),kept.join(format!("linear-{}.mp4",&media["lessons"]["linear"]["sha256"].as_str().unwrap()[..16]))).unwrap();
        for (key, part) in [("OSHAL_APPLICATIONS_DIR","apps"),("OSHAL_APP_PRIVATE_DIR","private"),("OSHAL_COMPANION_ARTIFACT_DIR","artifacts"),("OSHAL_PACKAGE_DATA_DIR","package-data")] { std::env::set_var(key, root.join(part)); }
        Self { root }
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); } }
async fn request(inst: &Installation, token: &str, method: &str, path: &str, body: Value) -> (u16, Value) {
    let req = Request::builder().method(method).uri(path).header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json").header("x-oshal-user-sub","forged-person")
        .body(if body.is_null() { Body::empty() } else { Body::from(body.to_string()) }).unwrap();
    let response = inst.router().oneshot(req).await.unwrap(); let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({"text":String::from_utf8_lossy(&bytes)}));
    if status >= 500 { eprintln!("fixture route {method} {path}: {value}"); }
    (status,value)
}
/// Only model wording is scripted; HTTP, named grants, dispatch and database writes are real.
#[derive(Debug,Default)]
struct Scripted {answers:Mutex<VecDeque<String>>}
#[async_trait::async_trait]
impl Provider for Scripted {
    fn id(&self)->ProviderId {ProviderId::new("prep-fixture-provider")}
    fn price(&self,_:&ModelId)->Option<inference::Price>{Some(inference::Price::FREE)}
    async fn complete(&self,model:&ModelId,_:&inference::CompletionRequest)->Result<inference::Completion,inference::ProviderError>{
        let text=self.answers.lock().unwrap().pop_front().ok_or_else(||inference::ProviderError::Unavailable("Unexpected fixture inference call".into()))?;
        Ok(inference::Completion{model:model.clone(),text,usage:inference::Usage::default()})
    }
}
#[tokio::test]
async fn native_prep_preserves_shared_bank_and_private_learning_records() {
    let dsn = std::env::var("OSHAL_TEST_POSTGRES").expect("explicit disposable PostgreSQL required");
    let pg: tokio_postgres::Config = dsn.parse().unwrap();
    assert!(pg.get_hosts().iter().all(|h| matches!(h,tokio_postgres::config::Host::Tcp(n) if n=="127.0.0.1" || n=="localhost")));
    assert!(!pg.get_ports().iter().any(|p| [5432,55432,55433,55434].contains(p)));
    let (admin, connection) = pg.connect(tokio_postgres::NoTls).await.unwrap();
    tokio::spawn(async move { let _ = connection.await; });
    let name = format!("lm_native_prep_{}", PrincipalId::generate().to_string().replace('-',""));
    admin.batch_execute(&format!("CREATE DATABASE {name}")).await.unwrap();
    let separator = if dsn.starts_with("postgres:") || dsn.starts_with("postgresql:") { if dsn.contains('?') {"&"} else {"?"} } else {" "};
    let config = Config {postgres:Some(format!("{dsn}{separator}dbname={name}")),deployment:kernel_types::Deployment::Home,..Config::for_tests()};
    let proof = tokio::spawn(async move { verify(config).await; }).await;
    admin.batch_execute(&format!("DROP DATABASE {name} WITH (FORCE)")).await.unwrap();
    proof.expect("native prep proof after owned database cleanup");
}
async fn verify(config: Config) {
    let _fixture = Fixture::new(); let mut inst = Installation::start(&config).await.unwrap();
    let model=Arc::new(Scripted::default());
    inst.inference.register(model.clone());
    inst.inference.set_fleet_default(BrainRecord{rung:BrainRung::FleetDefault,provider:model.id(),model:ModelId::new("prep-fixture-model")});
    inst.inference.set_failover_mesh(Vec::new());
    inst.host_services=Arc::new(oshald::host_services::InstallationHostServices::new(inst.notifier.clone(),inst.intents.clone())
        .with_bot_execution(inst.bots.clone(),Arc::new(inst.inference.clone())).with_package_tools(inst.loader.clone()));
    {let loader=inst.loader.lock().await;let package=loader.get(&PackageId::new("little-monsters")).expect("fixture package installed");assert!(package.is_serving(),"package rejections: {:?}",package.rejections);}
    let alice=inst.enrol_person("alice","prep-alice",Tier::Admin).await.unwrap();
    let bob=inst.enrol_person("bob","prep-bob",Tier::Admin).await.unwrap();
    let operator=inst.enrol_person("operator","prep-operator",Tier::Admin).await.unwrap();
    for person in [&alice,&bob,&operator] {inst.grants.grant(person.id,PackageId::new("little-monsters"),Tier::Editor).await.unwrap();}
    for (person,role) in [(&alice,"student"),(&bob,"student"),(&operator,"admin")] {
        let token=Config::for_tests().admin_token;
        let (_,catalog)=request(&inst,&token,"GET","/api/authorization/composites",Value::Null).await;
        let mut body=json!({"target":person.id,"assignment_id":format!("prep-{}",person.id),"action":"assign","expected_revision":catalog["revision"],"selection":{"kind":"granular","app":"little-monsters","role":role},"reason":"Isolated Study Lab proof","idempotency_key":format!("prep-{}",person.id)});
        let (status,preview)=request(&inst,&token,"POST","/api/authorization/composites/preview",body.clone()).await;assert_eq!(status,200,"role preview: {preview}");
        body["expected_plan_revision"]=preview["plan_revision"].clone();
        let (status,assigned)=request(&inst,&token,"POST","/api/authorization/composites/apply",body).await;assert_eq!(status,200,"role assignment: {assigned}");
    }
    // The operator installs the trusted shared-school policy before provisioning package schemas.
    let setup=inst.kernel.admit::<Write>(Entry::kernel(EntryKind::Cli,Credential::Bearer("alice".into()))).await.unwrap();
    let mut policy: Value=serde_json::from_slice(&std::fs::read(_fixture.root.join("apps/little-monsters/storage/relationships.json")).unwrap()).unwrap();
    policy["provisioning_tenant"]=json!(SCHOOL);
    setup.store(DataScope::Tenant).await.unwrap().execute(Statement::upsert("pkg:little-monsters:__sql_policy","active",policy)).await.unwrap();
    setup.store(DataScope::Tenant).await.unwrap().execute(Statement::upsert("pkg:little-monsters:lm_students",operator.id.to_string(),json!({"student_id":operator.id.to_string(),"external_id":operator.subject,"external_issuer":operator.issuer,"tenant_id":SCHOOL,"role":"admin","name":"Fixture operator","email":null}))).await.unwrap();
    setup.finish(Outcome::Ok);
    let (status,schema)=request(&inst,"operator","POST","/packages/little-monsters/schema",json!({})).await;
    assert_eq!(status,200,"schema: {schema}");assert_eq!(schema["complete"],true);
    let ctx=inst.kernel.admit::<Write>(Entry::kernel(EntryKind::Cli,Credential::Bearer("alice".into()))).await.unwrap();
    let store=ctx.store(DataScope::Tenant).await.unwrap();
    store.execute(Statement::upsert("pkg:little-monsters:lm_tenants",SCHOOL,json!({"tenant_id":SCHOOL}))).await.unwrap();
    for person in [&alice,&bob] {let id=person.id.to_string();store.execute(Statement::upsert("pkg:little-monsters:lm_students",&id,
        json!({"student_id":id,"external_id":person.subject,"external_issuer":person.issuer,"tenant_id":SCHOOL,"role":"student","name":"Fixture student","email":null}))).await.unwrap();}
    ctx.finish(Outcome::Ok);
    for (extension,mime) in [("jpg","image/jpeg"),("vtt","text/vtt; charset=utf-8")] {
        let response=inst.router().oneshot(Request::builder().uri(format!("/api/education/prep-media/linear.{extension}")).header("authorization","Bearer alice").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status().as_u16(),200,"native {extension} media delivery");
        assert_eq!(response.headers()["content-type"],mime);
        let bytes=response.into_body().collect().await.unwrap().to_bytes();
        let expected=std::fs::read(_fixture.root.join(format!("apps/little-monsters/tools/prep-media/linear.{extension}"))).unwrap();
        assert_eq!(bytes.as_ref(),expected.as_slice(),"native {extension} byte fidelity");
    }
    // A lesson video is larger than a package reply can carry, and a phone asks for byte ranges.
    let expected=std::fs::read(PathBuf::from(std::env::var_os("OSHAL_LM_PACKAGE_SOURCE").unwrap()).join(".videos/linear.mp4")).unwrap();
    assert!(expected.len()>8*1024*1024,"the fixture video must exceed the 8 MiB package reply limit");
    let response=inst.router().oneshot(Request::builder().uri("/api/education/prep-media/linear.mp4").header("authorization","Bearer alice").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status().as_u16(),200,"native whole video");
    assert_eq!(response.headers()["content-type"],"video/mp4");
    let bytes=response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(),expected.as_slice(),"native video byte fidelity");
    let response=inst.router().oneshot(Request::builder().uri("/api/education/prep-media/linear.mp4").header("authorization","Bearer alice").header("range","bytes=1000-1999").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status().as_u16(),206,"native media byte range");
    assert_eq!(response.headers()["accept-ranges"],"bytes");
    assert_eq!(response.headers()["content-type"],"video/mp4");
    let bytes=response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(),&expected[1000..2000],"native byte range fidelity");
    let (status,launch)=request(&inst,"alice","POST","/api/education/prep/launch",json!({"exam":"SAT","mode":"practice","skill":"linear"})).await;
    assert_eq!(status,200,"launch: {launch}");assert_eq!(launch["status"],"ready");
    let id=launch["sessionId"].as_str().unwrap();let route=format!("/api/education/prep/sessions/{id}");
    assert_eq!(request(&inst,"bob","GET",&route,Value::Null).await.0,404);
    let (_,ready)=request(&inst,"alice","GET",&route,Value::Null).await;assert!(ready["blocks"][0]["questions"].as_array().unwrap().is_empty());
    let (status,begun)=request(&inst,"alice","POST",&route,json!({"revision":0,"action":"begin"})).await;assert_eq!(status,200,"begin: {begun}");
    let q=begun["blocks"][0]["questions"][0]["id"].as_str().unwrap();
    let (status,saved)=request(&inst,"alice","POST",&route,json!({"revision":1,"action":"save","answers":{q:{"choice":0,"ms":0,"confidence":"sure","flagged":true}}})).await;assert_eq!(status,200,"save: {saved}");
    let (status,done)=request(&inst,"alice","POST",&route,json!({"revision":2,"action":"finish"})).await;assert_eq!(status,200,"finish: {done}");
    let (status,answers)=request(&inst,"alice","GET","/api/education/prep/answers?exam=SAT",Value::Null).await;assert_eq!(status,200,"answers: {answers}");assert_eq!(answers["answers"].as_array().unwrap().len(),8);
    let (_,others)=request(&inst,"bob","GET","/api/education/prep/answers?exam=SAT",Value::Null).await;assert!(others["answers"].as_array().unwrap().is_empty());
    let (status,pack)=request(&inst,"alice","POST","/api/education/prep/training",json!({"exam":"SAT","strategyIds":["systems"]})).await;assert_eq!(status,200,"training: {pack}");
    let training=format!("/api/education/prep/training/{}",pack["id"].as_str().unwrap());
    assert_eq!(request(&inst,"bob","GET",&training,Value::Null).await.0,404);
    let (status,updated)=request(&inst,"alice","POST",&training,json!({"revision":0,"action":"note","note":"Check coefficients."})).await;assert_eq!(status,200,"training update: {updated}");
    let (_,reloaded)=request(&inst,"alice","GET",&training,Value::Null).await;assert_eq!(reloaded["progress"]["note"],"Check coefficients.");
    let (_,progress)=request(&inst,"alice","GET","/api/education/prep/progress?exam=SAT",Value::Null).await;assert_eq!(progress["freshQuestions"],8);assert_eq!(progress["training"].as_array().unwrap().len(),1);
    let generated=json!({"summary":"Solve by eliminating one variable.","steps":["Align like terms.","Subtract matching coefficients.","Substitute to check both equations."],"workedExample":"x+y=5 and x-y=1 give 2x=6, so x=3 and y=2.","cards":[{"front":"First step?","back":"Align like terms."},{"front":"Why eliminate?","back":"Leave one unknown."},{"front":"How to check?","back":"Substitute in both equations."}]});
    model.answers.lock().unwrap().push_back(generated.to_string());
    let (status,personalized)=request(&inst,"alice","POST","/api/education/prep/training",json!({"exam":"SAT","strategyIds":["systems"],"mode":"personalized","goal":"Explain elimination slowly."})).await;
    assert_eq!(status,200,"personalized native generation: {personalized}");
    assert_eq!(personalized["content"]["summary"],generated["summary"]);
    assert!(model.answers.lock().unwrap().is_empty(),"personalization used the actual native model port");
    // Invoke the actual source-pinned contracts used by Jarvis with Alice's admitted authority.
    for (name,input) in [
        ("lm-test-prep-progress",json!({"exam":"SAT"})),
        ("lm-test-prep-topics",json!({"exam":"SAT","query":"systems"})),
        ("lm-test-prep-answers",json!({"exam":"SAT"})),
        ("lm-test-prep-start",json!({"exam":"ACT","mode":"practice","skill":"linear"})),
        ("lm-test-prep-create-training",json!({"exam":"ACT","strategyIds":["systems"]})),
        ("lm-test-prep-my-training",json!({"exam":"ACT"})),
        ("lm-test-prep-training-content",json!({"trainingId":pack["id"]})),
        ("lm-test-prep-save-training",json!({"trainingId":pack["id"],"revision":1,"action":"note","note":"Saved through Jarvis."})),
        ("lm-test-prep-save-plan",json!({"exam":"SAT","dailyMinutes":20,"testDate":""})),
    ] {
        model.answers.lock().unwrap().extend([format!("```tool_call\n{}\n```",json!({"tool":name,"arguments":input})),"Continue in SAT & ACT.".to_owned()]);
        let (status,result)=request(&inst,"alice","POST","/api/swarm/bots/test-prep-coach/ask",json!({"message":format!("Please use {name} to help me study now."),"sessionId":format!("prep-{name}")})).await;
        assert_eq!(status,200,"{name}: {result}");
        assert!(result["toolsUsed"].as_array().unwrap().iter().any(|t|t["tool"]==name),"{name} did not run: {result}");
        assert!(model.answers.lock().unwrap().is_empty(),"{name}: tool observation did not return to the concierge");
    }
    let (_,reloaded)=request(&inst,"alice","GET",&training,Value::Null).await;assert_eq!(reloaded["progress"]["note"],"Saved through Jarvis.");
    let ctx=inst.kernel.admit::<Write>(Entry::kernel(EntryKind::Cli,Credential::Bearer("bob".into()))).await.unwrap();
    let host=CtxHost::new(&ctx,PackageId::new("little-monsters"),[Capability::person("store.read"),Capability::person("store.write")].into_iter().collect(),None);
    let rows=host.sql_query(json!({"text":"SELECT question_id FROM lm_prep_questions"})).await.unwrap();assert_eq!(rows["rows"].as_array().unwrap().len(),222);
    assert!(host.sql_query(json!({"text":"UPDATE lm_prep_questions SET skill='changed'"})).await.is_err(),"student cannot mutate shared bank");
    assert!(host.sql_query(json!({"text":"INSERT INTO lm_prep_questions (catalog_version,question_id,skill,question) VALUES ('fixture','denied','linear','{}'::jsonb)"})).await.is_err(),"student cannot seed shared bank");
    ctx.finish(Outcome::Ok);
}
