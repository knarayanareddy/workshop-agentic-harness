import { failure, success, type Tool } from "@harness/api";
import { toolbox } from "../../helpers";

/** Tells the model how far start_toolbox has got, and what to do about it. */
export const toolboxStatus: Tool = {
  name: "toolbox_status",
  description: "Report whether the OpenRA toolbox from start_toolbox is ready, still starting or failed, with the last lines of its log.",
  inputSchema: { type: "object", properties: {} },

  execute(_input, ctx) {
    const status = toolbox.status(ctx);
    switch (status.state) {
      case "not_started":
        return failure("The toolbox has not been started. Call start_toolbox.");
      case "ready":
        return success("The toolbox is ready.");
      case "failed":
        return failure(`Starting the toolbox failed:\n${status.log}`);
      case "starting":
        return success(`Still starting. Do not wait for it: tell the user, and check again later.\n${status.log}`);
    }
  },
};
