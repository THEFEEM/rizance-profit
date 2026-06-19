export type AppContextMode = "regular" | "booth" | "project";

export type AppContextRegular = { mode: "regular" };

export type AppContextBooth = {
  mode: "booth";
  boothId: string;
  boothName: string;
};

export type AppContextProject = {
  mode: "project";
  projectId: string;
  projectName: string;
  orgName: string | null;
};

export type AppContext = AppContextRegular | AppContextBooth | AppContextProject;
