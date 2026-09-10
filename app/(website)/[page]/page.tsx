import { notFound } from "next/navigation";
import { PublicPageContent, publicPages, PublicShell, type PublicPage } from "../../../components/PublicSite";
export function generateStaticParams() { return Object.keys(publicPages).map((page) => ({ page })); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const content = publicPages[page as PublicPage];
  return content ? { title: content.title + " | NeighborWalk", description: content.description, alternates: { canonical: "/" + page } } : {};
}
export default async function InformationPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in publicPages)) notFound();
  return <PublicShell><PublicPageContent page={page as PublicPage} /></PublicShell>;
}
