import Link from "next/link";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function NotebookOverviewCard({
  notebook,
  onRename,
  onDelete,
}: {
  notebook: Doc<"notebooks">;
  onRename: (notebookId: Id<"notebooks">, initialName: string) => void;
  onDelete: (notebookId: Id<"notebooks">, initialName: string) => void;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardDescription>
          Created {new Date(notebook._creationTime).toLocaleDateString()}
        </CardDescription>
        <CardTitle className="line-clamp-2 text-2xl">{notebook.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href={`/${notebook._id}`}>Open notebook</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => onRename(notebook._id, notebook.name)}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(notebook._id, notebook.name)}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function NotebookOverviewSkeletonCard() {
  return (
    <Card className="min-h-44 animate-pulse border-dashed">
      <CardHeader>
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-8 w-2/3 rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-4 w-full rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export function NotebookOverviewEmptyState({
  onCreateNotebook,
}: {
  onCreateNotebook: () => void;
}) {
  return (
    <Card className="mt-6 border-dashed">
      <CardHeader>
        <CardTitle>No notebooks yet</CardTitle>
        <CardDescription>
          Create your first notebook to start organizing sources and chatting
          with it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onCreateNotebook}>Create your first notebook</Button>
      </CardContent>
    </Card>
  );
}
