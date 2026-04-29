import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type RunningSessionCloseDialogProps = {
	open: boolean;
	agentLabel: string;
	loading?: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
};

export function RunningSessionCloseDialog({
	open,
	agentLabel,
	loading = false,
	onOpenChange,
	onConfirm,
}: RunningSessionCloseDialogProps) {
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Close running chat?"
			description={`This chat is currently running. Closing it will cancel ${agentLabel}.`}
			confirmLabel="Close anyway"
			onConfirm={onConfirm}
			loading={loading}
		/>
	);
}
