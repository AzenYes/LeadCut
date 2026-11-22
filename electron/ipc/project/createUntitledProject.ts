import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_FILE_EXTENSION } from "../../../src/lib/projectFileExtensions";
/** Publish a complete new project without overwriting a concurrent or existing save. */
export async function createUntitledProject(
	directory: string,
	contents: string,
	createdAt = new Date(),
) {
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())}`;
	const time = [createdAt.getHours(), createdAt.getMinutes(), createdAt.getSeconds()]
		.map(pad)
		.join("-");
	const name = `项目_${date}_${time}`;
	await fs.mkdir(directory, { recursive: true });
	const temporary = path.join(directory, `.leadcut-new-${randomUUID()}.tmp`);
	try {
		const file = await fs.open(temporary, "wx");
		try {
			await file.writeFile(contents, "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
		for (let suffix = 0; ; suffix++) {
			const target = path.join(directory, `${name}${suffix ? `_${suffix}` : ""}.${PROJECT_FILE_EXTENSION}`);
			try {
				await fs.link(temporary, target);
				return target;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
	} finally {
		await fs.rm(temporary, { force: true });
	}
}
