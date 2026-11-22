import path from "node:path";
import { app } from "electron";
import { APP_DATA_FOLDER, APP_NAME } from "./appIdentity";

app.setName(APP_NAME);
const editionDataPath = process.env.LEADCUT_USER_DATA_DIR
	? path.resolve(process.env.LEADCUT_USER_DATA_DIR)
	: path.join(
	app.getPath("appData"),
	`${APP_DATA_FOLDER}${process.env["VITE_DEV_SERVER_URL"] ? "-dev" : ""}`,
);
app.setPath("userData", editionDataPath);
app.setPath("sessionData", path.join(editionDataPath, "session"));

export const USER_DATA_PATH = app.getPath("userData");
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");
