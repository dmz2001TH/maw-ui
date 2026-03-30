import { mount } from "../core/mount";
import { AppShell } from "../core/AppShell";
import { ConfigView } from "../components/ConfigView";

mount(() => (
  <AppShell view="config" fullHeight>
    {() => <ConfigView />}
  </AppShell>
));
