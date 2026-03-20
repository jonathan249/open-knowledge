import { NotebookOverview } from "@/components/notebook-overview";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16 text-[#171717] dark:bg-[#111111] dark:text-[#f3f3ef]">
        <div className="w-full max-w-2xl rounded-2xl border border-[#e5e5e5] bg-white/80 p-8 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-[#181818] dark:shadow-none">
          <p className="text-sm font-medium text-[#6f6f6f] dark:text-[#a1a1aa]">
            Setup required
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em]">
            Add your Convex and AI Gateway environment values
          </h1>
          <p className="mt-4 text-base text-[#6f6f6f] dark:text-[#a1a1aa]">
            I created a placeholder <code>.env.local</code> for you. Fill in{" "}
            <code>NEXT_PUBLIC_CONVEX_URL</code>, <code>CONVEX_DEPLOYMENT</code>,
            and <code>AI_GATEWAY_API_KEY</code>, then rerun Convex codegen/dev.
          </p>
          <div className="mt-6 rounded-xl bg-[#f2f2f0] p-4 text-sm text-[#6f6f6f] dark:bg-white/10 dark:text-[#a1a1aa]">
            Once those values are set, this page will switch from setup mode into the persistent streamed chat UI.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white dark:bg-[#111111]">
      <NotebookOverview />
    </main>
  );
}
