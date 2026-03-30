import { mount } from "../core/mount";
import { AppShell } from "../core/AppShell";
import { TerminalView } from "../components/TerminalView";

mount(() => (
  <AppShell view="terminal" fullHeight>
    {(ctx) => (
      <TerminalView
        sessions={ctx.sessions}
        agents={ctx.agents}
        connected={ctx.connected}
        onSelectAgent={ctx.onSelectAgent}
      />
    )}
  </AppShell>
));
