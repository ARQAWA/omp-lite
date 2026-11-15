import modelPicker from "./model-picker.js";
import subscriptions from "./subscriptions.js";
import compactions from "./compactions.js";
import toolSummary from "./tool-summary.js";
import turnDuration from "./turn-duration.js";

export default pi => [modelPicker, subscriptions, compactions, toolSummary, turnDuration].forEach(part => part(pi));
