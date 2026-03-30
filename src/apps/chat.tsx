import { mount } from "../core/mount";
import { AppShell } from "../core/AppShell";
import { ChatView } from "../components/ChatView";

mount(() => (
  <AppShell view="chat">
    {() => <ChatView />}
  </AppShell>
));
