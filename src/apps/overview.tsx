import { mount } from "../core/mount";
import { AppShell } from "../core/AppShell";
import { OverviewGrid } from "../components/OverviewGrid";

mount(() => (
  <AppShell view="overview">
    {(ctx) => (
      <OverviewGrid
        sessions={ctx.sessions}
        agents={ctx.agents}
        connected={ctx.connected}
        send={ctx.send}
        onSelectAgent={ctx.onSelectAgent}
      />
    )}
  </AppShell>
));
