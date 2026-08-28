import { Model } from "../types";
import { OpenrouterModels } from "./openrouter";

export * from './openrouter';
export const allInternalModels: Model[] = [...OpenrouterModels];
