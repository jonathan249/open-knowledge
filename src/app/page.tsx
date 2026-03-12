import { NotebookOverview } from "@/components/notebook-overview";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
        <div className="w-full max-w-2xl rounded-3xl border bg-card p-8 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Setup required</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Add your Convex and AI Gateway environment values</h1>
          <p className="mt-4 text-base text-muted-foreground">
            I created a placeholder <code>.env.local</code> for you. Fill in <code>NEXT_PUBLIC_CONVEX_URL</code>,
            <code> CONVEX_DEPLOYMENT</code>, and <code>AI_GATEWAY_API_KEY</code>, then rerun Convex codegen/dev.
          </p>
          <div className="mt-6 rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
            Once those values are set, this page will switch from setup mode into the persistent streamed chat UI.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <NotebookOverview />
    </main>
  );
}
