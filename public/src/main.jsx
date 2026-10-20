const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#13988D",
  "density": "compact",
  "radius": 18
}/*EDITMODE-END*/;

function shade(hex, f){ // darken
  const n = parseInt(hex.slice(1),16);
  const r=Math.round(((n>>16)&255)*f), g=Math.round(((n>>8)&255)*f), b=Math.round((n&255)*f);
  return `rgb(${r},${g},${b})`;
}
function soft(hex){
  const n = parseInt(hex.slice(1),16);
  const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  return `rgba(${r},${g},${b},0.13)`;
}

function Root(){
  const { user, canSee } = useApp();
  const resetToken = React.useMemo(() => new URLSearchParams(window.location.search).get("reset"), []);
  const [page, setPage] = React.useState("overview");
  const [selCust, setSelCust] = React.useState(null);
  const [selProj, setSelProj] = React.useState(null);
  const [selPO, setSelPO] = React.useState(null);
  const [newProjFor, setNewProjFor] = React.useState(null);
  const [poFromQuote, setPoFromQuote] = React.useState(null);
  const [poDates, setPoDates] = React.useState(null);

  React.useEffect(() => {
    if (user && !canSee(page)) {
      const first = window.CRM.MODULES.find(m => canSee(m));
      if (first) setPage(first);
    }
  }, [user, page]);

  if (resetToken) return <ResetPasswordScreen token={resetToken} />;
  if (!user) return <LoginScreen />;

  const openCustomer = (id) => { setSelCust(id); setPage("customers"); };
  const openProject = (id) => { setSelProj(id); setPage("projects"); };
  const openPO = (id) => { setSelPO(id); setPage("polist"); };
  const openNewProject = (custId) => { setNewProjFor(custId); setPage("projects"); };
  const openPOFromQuote = (quote) => { setPoFromQuote(quote); setPage("polist"); };
  const openPOPeriod = (range) => { setPoDates(range); setSelPO(null); setPage("polist"); };

  return (
    <Shell page={page} setPage={(p) => { setPage(p); if (p !== "customers") setSelCust(null); if (p !== "projects") setSelProj(null); if (p !== "polist") setSelPO(null); }}>
      {page === "overview" && <OverviewPage goCustomer={openCustomer} goProjects={() => setPage("projects")} goProject={openProject} goReorder={() => setPage("retention")} goPOPeriod={openPOPeriod} />}
      {page === "customers" && <CustomersPage selected={selCust} setSelected={setSelCust} openNewProject={openNewProject} openProject={openProject} openPO={openPO} />}
      {page === "pipelines" && <PipelinesPage openCustomer={openCustomer} openProject={openProject} />}
      {page === "projects" && <ProjectsPage openCustomer={openCustomer} newProjectFor={newProjFor} clearNewProjectFor={() => setNewProjFor(null)} selected={selProj} setSelected={setSelProj} />}
      {page === "samples" && <SamplesPage openCustomer={openCustomer} openProject={openProject} />}
      {page === "quotations" && <QuotationsPage openCustomer={openCustomer} openProject={openProject} openPOFromQuote={openPOFromQuote} />}
      {page === "polist" && <POListPage openCustomer={openCustomer} selected={selPO} setSelected={setSelPO} presetFromQuote={poFromQuote} clearPresetFromQuote={() => setPoFromQuote(null)} presetDates={poDates} clearPresetDates={() => setPoDates(null)} />}
      {page === "products" && <ProductsPage />}
      {page === "target" && <TargetPage />}
      {page === "forecast" && <SalesForecastPage />}
      {page === "retention" && <RetentionPage openCustomer={openCustomer} />}
      {page === "admin" && <AdminPage />}
    </Shell>
  );
}

function App(){
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const style = {
    "--teal": tw.accent,
    "--teal-dark": shade(tw.accent, 0.78),
    "--teal-soft": soft(tw.accent),
    "--radius": tw.radius + "px",
    fontSize: tw.density === "compact" ? "13px" : "14px",
  };
  return (
    <div style={style}>
      <AppProvider tweaks={tw}>
        <Root />
      </AppProvider>
      <TweaksPanel>
        <TweakSection label="Brand" />
        <TweakColor label="Accent" value={tw.accent}
          options={["#13988D", "#1C3D5A", "#0E7A71", "#2563EB"]}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={tw.density} options={["regular", "compact"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakSlider label="Corner radius" value={tw.radius} min={4} max={20} unit="px"
          onChange={(v) => setTweak("radius", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
