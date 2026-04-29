import { getRepoData } from "@/lib/github";
import "./marketing.css";
import { MarketingShell } from "./marketing-shell";

// ISR: statically render at build time, refresh in the background every hour
// so version / commit / license stay current without a redeploy.
export const revalidate = 3600;

export default async function HomePage() {
	const data = await getRepoData();
	return <MarketingShell data={data} />;
}
