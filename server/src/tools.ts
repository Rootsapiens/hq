// Tools the model can call. assign_task is offered to the Boss only.
import { z } from "zod";
import { AGENTS, type AgentConfig } from "../agents.config";
import type { ToolDef } from "./model";

export const AssignTaskInput = z.object({ agent: z.string().min(1), task: z.string().min(1) });
export const ReportResultInput = z.object({ summary: z.string().min(1), needs_input: z.boolean().optional() });
export const UpdateStatusInput = z.object({ status: z.enum(["WORKING", "THINKING"]), note: z.string().optional() });

export function toolsFor(agent: AgentConfig): ToolDef[] {
  const workers = AGENTS.filter((a) => !a.isBoss).map((a) => a.id);
  const tools: ToolDef[] = [
    {
      name: "update_status",
      description: "Set your visible status: WORKING while doing the task, THINKING while planning. Add a short note of what you are on.",
      input_schema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["WORKING", "THINKING"] },
          note: { type: "string", description: "Short note, max ~8 words." },
        },
        required: ["status"],
      },
    },
    {
      name: "report_result",
      description: "Report the result of the current task. Call exactly once when finished. Set needs_input when blocked on the owner.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One or two sentences: what was done and the proof." },
          needs_input: { type: "boolean" },
        },
        required: ["summary"],
      },
    },
  ];
  if (agent.isBoss) {
    tools.unshift({
      name: "assign_task",
      description: "Delegate a task to one team member. They meet you in the Meeting Room, then work on it and report back.",
      input_schema: {
        type: "object",
        properties: {
          agent: { type: "string", enum: workers },
          task: { type: "string", description: "One clear task: goal and done-check." },
        },
        required: ["agent", "task"],
      },
    });
  }
  return tools;
}
