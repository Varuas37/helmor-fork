import {
	AlertTriangleIcon,
	ChevronDownIcon,
	GitBranchIcon,
	Layers3Icon,
	Loader2Icon,
	Maximize2Icon,
	RefreshCcwIcon,
	SparklesIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, Suspense, useState } from "react";
import { LazyStreamdown } from "@/components/streamdown-loader";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { FileReviewSummary } from "./types";

export type ReviewSummaryPanelState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; summary: FileReviewSummary }
	| { status: "error"; message: string };

export function ReviewSummaryPanel({
	state,
	onRegenerate,
	onClose,
}: {
	state: ReviewSummaryPanelState;
	onRegenerate: () => void;
	onClose: () => void;
}) {
	return (
		<div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background text-foreground">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
				<SparklesIcon className="size-3.5 text-primary" strokeWidth={1.8} />
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium">
					Review summary
				</span>
				<Button
					type="button"
					variant="outline"
					size="xs"
					onClick={onRegenerate}
					disabled={state.status === "loading"}
					className="gap-1.5 bg-transparent"
				>
					{state.status === "loading" ? (
						<Loader2Icon
							data-icon="inline-start"
							className="size-3 animate-spin"
							strokeWidth={1.8}
						/>
					) : (
						<RefreshCcwIcon
							data-icon="inline-start"
							className="size-3"
							strokeWidth={1.8}
						/>
					)}
					{state.status === "ready" ? "Refresh" : "Generate"}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Back to diff"
					onClick={onClose}
					className="size-6 text-muted-foreground hover:text-foreground"
				>
					<XIcon className="size-3.5" strokeWidth={1.8} />
				</Button>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div
					className={cn(
						"mx-auto w-full space-y-5 px-8 py-6",
						state.status === "ready" && state.summary.html
							? "max-w-[1220px]"
							: "max-w-[980px]",
					)}
				>
					{state.status === "loading" && <PanelMessage text="Summarizing..." />}
					{state.status === "idle" && (
						<PanelMessage text="Generate a summary for this file diff." />
					)}
					{state.status === "error" && (
						<div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[12px] leading-5 text-destructive">
							{state.message}
						</div>
					)}
					{state.status === "ready" && (
						<SummaryContent summary={state.summary} />
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

function SummaryContent({ summary }: { summary: FileReviewSummary }) {
	const hasPlainSummary = hasMeaningfulPlainSummary(summary);
	const rows = summary.beforeAfter;
	const hasTechnicalChanges = summary.technicalChanges.length > 0;
	const hasRiskNotes = summary.riskNotes.length > 0;
	const htmlFocused =
		Boolean(summary.html) &&
		!summary.markdown &&
		!summary.mermaid &&
		!hasPlainSummary &&
		rows.length === 0 &&
		summary.userFeatureImpact.length === 0 &&
		!hasTechnicalChanges &&
		!hasRiskNotes &&
		summary.layers.length === 0 &&
		summary.sequence.length === 0;

	return (
		<>
			{summary.html ? (
				<HtmlArtifact html={summary.html} featured={htmlFocused} />
			) : null}
			{summary.markdown ? (
				<MarkdownArtifact markdown={summary.markdown} />
			) : null}
			{summary.mermaid ? <MermaidArtifact mermaid={summary.mermaid} /> : null}
			{hasPlainSummary ? (
				<section className="space-y-2">
					<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
						What changed
					</h3>
					<p className="max-w-[78ch] text-[14px] leading-6 text-foreground">
						{summary.plainLanguageSummary}
					</p>
				</section>
			) : null}
			{rows.length > 0 ? <BeforeAfterTable rows={rows} /> : null}
			<SummaryList title="User impact" items={summary.userFeatureImpact} />
			{hasTechnicalChanges ? (
				<DetailSection title="Technical detail">
					<SummaryList
						title="Technical changes"
						items={summary.technicalChanges}
					/>
				</DetailSection>
			) : null}
			{hasRiskNotes ? (
				<DetailSection
					title="Risks"
					icon={<AlertTriangleIcon className="size-3" strokeWidth={1.8} />}
				>
					<SummaryList title="Risk notes" items={summary.riskNotes} />
				</DetailSection>
			) : null}
			{summary.layers.length > 0 && (
				<DetailSection
					title="Layers"
					icon={<Layers3Icon className="size-3" strokeWidth={1.8} />}
				>
					<div className="space-y-1.5">
						{summary.layers.map((layer) => (
							<div
								key={`${layer.name}-${layer.summary}`}
								className="rounded-md border border-border/70 bg-background/55 p-2"
							>
								<div className="text-[12px] font-medium text-foreground">
									{layer.name}
								</div>
								<p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
									{layer.summary}
								</p>
							</div>
						))}
					</div>
				</DetailSection>
			)}
			{summary.sequence.length > 0 && (
				<DetailSection
					title="Flow"
					icon={<GitBranchIcon className="size-3" strokeWidth={1.8} />}
				>
					<div className="space-y-1">
						{summary.sequence.map((step, index) => (
							<div
								key={`${step.from}-${step.to}-${step.label}-${index}`}
								className="grid grid-cols-[72px_1fr_72px] items-center gap-1 text-[11px]"
							>
								<FlowNode label={step.from} />
								<div className="min-w-0 border-t border-dashed border-border pt-1 text-center text-muted-foreground">
									<span className="line-clamp-2">{step.label}</span>
								</div>
								<FlowNode label={step.to} />
							</div>
						))}
					</div>
				</DetailSection>
			)}
		</>
	);
}

function BeforeAfterTable({
	rows,
}: {
	rows: Array<{ before: string; after: string; impact?: string }>;
}) {
	return (
		<section className="space-y-1.5">
			<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
				Before / after
			</h3>
			<div className="overflow-hidden rounded-md border border-border/70">
				<Table className="text-[12px]">
					<TableHeader className="bg-muted/35">
						<TableRow className="hover:bg-transparent">
							<TableHead className="h-8 w-[31%] px-3">Before</TableHead>
							<TableHead className="h-8 w-[31%] px-3">After</TableHead>
							<TableHead className="h-8 px-3">Why it matters</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row, index) => (
							<TableRow
								key={`${row.before}-${row.after}-${index}`}
								className="align-top hover:bg-muted/25"
							>
								<TableCell className="px-3 py-2 leading-5 text-muted-foreground">
									{row.before}
								</TableCell>
								<TableCell className="px-3 py-2 leading-5 text-foreground">
									{row.after}
								</TableCell>
								<TableCell className="px-3 py-2 leading-5 text-muted-foreground">
									{row.impact ?? "Review this as part of the changed behavior."}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</section>
	);
}

function DetailSection({
	title,
	icon,
	children,
}: {
	title: string;
	icon?: ReactNode;
	children: ReactNode;
}) {
	return (
		<details className="group rounded-md border border-border/70 bg-background/35">
			<summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
				{icon}
				<span className="min-w-0 flex-1">{title}</span>
				<ChevronDownIcon
					className="size-3 transition-transform group-open:rotate-180"
					strokeWidth={1.8}
				/>
			</summary>
			<div className="border-t border-border/60 px-3 py-2">{children}</div>
		</details>
	);
}

function HtmlArtifact({
	html,
	featured = false,
}: {
	html: string;
	featured?: boolean;
}) {
	const [fullscreenOpen, setFullscreenOpen] = useState(false);
	const srcDoc = buildSandboxedHtml(html);

	return (
		<section className="space-y-1.5">
			<div className="flex items-center gap-2">
				<h3 className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
					HTML
				</h3>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Open HTML preview fullscreen"
					onClick={() => setFullscreenOpen(true)}
					className="size-6 text-muted-foreground hover:text-foreground"
				>
					<Maximize2Icon className="size-3.5" strokeWidth={1.8} />
				</Button>
			</div>
			<div className="overflow-hidden rounded-md border border-border/70 bg-background">
				<iframe
					title="Review summary HTML preview"
					srcDoc={srcDoc}
					sandbox="allow-scripts"
					className={cn(
						"w-full bg-background",
						featured ? "h-[calc(100vh-185px)] min-h-[520px]" : "h-[360px]",
					)}
				/>
			</div>
			<Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
				<DialogContent
					showCloseButton={false}
					className="flex h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-md p-0"
				>
					<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
						<DialogTitle className="min-w-0 flex-1 truncate text-[13px] font-medium">
							HTML review artifact
						</DialogTitle>
						<DialogClose asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label="Close fullscreen HTML preview"
								className="size-6 text-muted-foreground hover:text-foreground"
							>
								<XIcon className="size-3.5" strokeWidth={1.8} />
							</Button>
						</DialogClose>
					</div>
					<iframe
						title="Fullscreen review summary HTML preview"
						srcDoc={srcDoc}
						sandbox="allow-scripts"
						className="min-h-0 w-full flex-1 bg-background"
					/>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function MarkdownArtifact({ markdown }: { markdown: string }) {
	return (
		<section className="space-y-1.5">
			<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
				Markdown
			</h3>
			<div className="assistant-markdown-scale rounded-md border border-border/70 bg-background/55 p-2 text-[12px] leading-5">
				<Suspense
					fallback={<div className="whitespace-pre-wrap">{markdown}</div>}
				>
					<LazyStreamdown className="conversation-streamdown" mode="static">
						{markdown}
					</LazyStreamdown>
				</Suspense>
			</div>
		</section>
	);
}

function MermaidArtifact({ mermaid }: { mermaid: string }) {
	const markdown = ["```mermaid", mermaid, "```"].join("\n");

	return (
		<section className="space-y-1.5">
			<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
				Mermaid
			</h3>
			<div className="assistant-markdown-scale rounded-md border border-border/70 bg-background/55 p-2 text-[12px] leading-5">
				<Suspense fallback={<pre>{mermaid}</pre>}>
					<LazyStreamdown className="conversation-streamdown" mode="static">
						{markdown}
					</LazyStreamdown>
				</Suspense>
			</div>
		</section>
	);
}

function SummaryList({
	title,
	items,
	icon,
}: {
	title: string;
	items: string[];
	icon?: React.ReactNode;
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<section className="space-y-1">
			<h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
				{icon}
				{title}
			</h3>
			<ul className="space-y-1 text-[12px] leading-5 text-foreground">
				{items.map((item) => (
					<li key={item} className="flex gap-1.5">
						<span className="mt-[0.55rem] size-1 shrink-0 rounded-full bg-muted-foreground/70" />
						<span>{item}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function FlowNode({ label }: { label: string }) {
	return (
		<div
			className={cn(
				"flex h-8 min-w-0 items-center justify-center rounded-md border border-border/70 bg-background/70 px-1 text-center text-[10.5px] font-medium leading-3 text-foreground",
			)}
		>
			<span className="line-clamp-2">{label}</span>
		</div>
	);
}

function PanelMessage({ text }: { text: string }) {
	return <p className="text-[12px] leading-5 text-muted-foreground">{text}</p>;
}

function hasMeaningfulPlainSummary(summary: FileReviewSummary) {
	const text = summary.plainLanguageSummary.trim();
	return Boolean(text) && !isArtifactPlaceholderSummary(text);
}

function isArtifactPlaceholderSummary(text: string) {
	return (
		text === "Generated HTML review artifact." ||
		text === "Generated Mermaid review artifact."
	);
}

function buildSandboxedHtml(html: string): string {
	return [
		"<!doctype html>",
		"<html>",
		"<head>",
		'<meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		'<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; script-src &#39;unsafe-inline&#39;; img-src data: blob:;" />',
		"<style>html,body{margin:0;background:transparent;color:inherit;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;}</style>",
		"</head>",
		"<body>",
		html,
		"</body>",
		"</html>",
	].join("");
}
