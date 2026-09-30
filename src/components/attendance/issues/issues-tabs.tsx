import Link from "next/link";
import { TabLabel, tabLinkClass, tabListClass } from "../attendance-tab-styles";
import { issuesTabHref, type IssuesTab } from "./issues-navigation";

const TAB_LABEL: Record<IssuesTab, string> = {
  all: "All",
  exceptions: "Exceptions",
  corrections: "Correction Requests",
};

/** Plain-link segmented control, same server-driven convention as `CorrectionsStatusFilter`. Styled as
 *  the quieter secondary tier under the Attendance module bar; behaviour and URLs are unchanged. */
export function IssuesTabs({ tabs, active }: { tabs: IssuesTab[]; active: IssuesTab }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Issues and corrections" className={tabListClass("secondary")}>
      {tabs.map((tab) => (
        <Link key={tab} href={issuesTabHref(tab)} aria-current={tab === active ? "page" : undefined} className={tabLinkClass("secondary", tab === active)}>
          <TabLabel>{TAB_LABEL[tab]}</TabLabel>
        </Link>
      ))}
    </nav>
  );
}
