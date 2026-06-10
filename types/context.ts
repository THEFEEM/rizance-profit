export type AppContextMode = "regular" | "booth";

export type AppContextRegular = { mode: "regular" };

export type AppContextBooth = {
  mode: "booth";
  boothId: string;
  boothName: string;
};

export type AppContext = AppContextRegular | AppContextBooth;
