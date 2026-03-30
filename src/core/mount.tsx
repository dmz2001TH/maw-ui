/** Shared mount helper — each app calls this with its view component */
import { createRoot } from "react-dom/client";
import "../index.css";

export function mount(App: () => JSX.Element) {
  createRoot(document.getElementById("root")!).render(<App />);
}
