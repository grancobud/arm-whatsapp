import { registry } from "./registry";
import { echoTool } from "./tools/echo";
import { scheduleLinkTool } from "./tools/schedule-link";
import { scheduleHighLevelTool } from "./tools/schedule-highlevel";
import { checkAvailabilityTool } from "./tools/check-availability";
import { customWebhookTool } from "./tools/custom-webhook";
import { requestHumanTool } from "./tools/request-human";
import { updateContactTool } from "./tools/update-contact";
import { rememberFactTool } from "./tools/remember-fact";
import { scheduleFollowUpTool } from "./tools/schedule-followup";

registry.register(echoTool);
registry.register(scheduleLinkTool);
registry.register(scheduleHighLevelTool);
registry.register(checkAvailabilityTool);
registry.register(customWebhookTool);
registry.register(rememberFactTool);
registry.register(scheduleFollowUpTool);
registry.register(requestHumanTool);
registry.register(updateContactTool);

export { registry };
export type {
  Tool,
  ToolContext,
  ToolResult,
  ToolSensitivity,
} from "./core/tool";
