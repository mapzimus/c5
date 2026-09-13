import "./styles.css";
import { App } from "./app";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing");
new App(root).start();
