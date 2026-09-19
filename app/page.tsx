import { LegacyEntry } from "../components/LegacyEntry";
import { HomeContent, PublicShell } from "../components/PublicSite";

export default function Home() {
  return <PublicShell><LegacyEntry /><HomeContent /></PublicShell>;
}
