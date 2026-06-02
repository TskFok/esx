import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";
import { queryClient } from "./lib/query-client";
import { AppStateProvider } from "./providers/app-state";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </QueryClientProvider>,
);
