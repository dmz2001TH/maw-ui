import { mount } from "../core/mount";
import { AppShell } from "../core/AppShell";
import { BridgeView } from "../components/BridgeView";

mount(() => (
  <AppShell view="bridge">
    {(ctx) => (
      <BridgeView
        agents={ctx.agents}
        connected={ctx.connected}
      />
    )}
  </AppShell>
));
