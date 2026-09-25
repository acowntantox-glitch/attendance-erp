import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AttendanceDayRecord, AttendanceSessionView } from "@/domains/attendance/model";
import { TodayAttendanceCard } from "./today-attendance-card";
import { CurrentSessionPanel } from "./current-session-panel";
import { SessionsTable } from "./sessions-table";
import { HistoryPanel } from "./history-panel";
import { EmployeeCorrectionsPanel } from "./corrections/employee-corrections-panel";

/**
 * Server-rendered shell: "today" data (record, sessions, current session) is fetched once by the
 * parent Server Component and passed down — this component and its children only ever display
 * it. History is fetched client-side (it needs interactive date filtering) by `HistoryPanel`.
 */
export function AttendanceWorkspace({
  employeeId,
  canControl,
  canRequestCorrection,
  employeeTimezone,
  workDate,
  record,
  sessions,
  currentSession,
  hasOpenBreak,
  periodClosed,
}: {
  employeeId: string;
  canControl: boolean;
  canRequestCorrection: boolean;
  employeeTimezone: string;
  workDate: string;
  record: AttendanceDayRecord;
  sessions: AttendanceSessionView[];
  currentSession: AttendanceSessionView | null;
  hasOpenBreak: boolean;
  /** Whether `workDate`'s month is closed (Batch 8). The server independently rejects the
   *  underlying mutations either way — this only lets the controls explain themselves instead of
   *  failing with an error toast after the fact. */
  periodClosed: boolean;
}) {
  const referenceSession = sessions[0] ?? currentSession ?? null;

  return (
    <Tabs defaultValue="today">
      <TabsList>
        <TabsTrigger value="today">Today</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="corrections">Corrections</TabsTrigger>
      </TabsList>

      <TabsContent value="today">
        <div className="space-y-6">
          {/* Current-session state is always shown — canControl only hides the action buttons
              inside, so an HR/authorized viewer still sees "checked in"/"on break" state. */}
          <CurrentSessionPanel
            employeeId={employeeId}
            canControl={canControl}
            session={currentSession}
            hasOpenBreak={hasOpenBreak}
            periodClosed={periodClosed}
          />

          <TodayAttendanceCard workDate={workDate} record={record} referenceSession={referenceSession} />

          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Sessions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <SessionsTable sessions={sessions} />
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="history">
        <Card>
          <CardContent>
            <HistoryPanel employeeId={employeeId} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="corrections">
        <Card>
          <CardContent>
            <EmployeeCorrectionsPanel
              employeeId={employeeId}
              timezone={employeeTimezone}
              canRequest={canRequestCorrection}
              defaultWorkDate={workDate}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
