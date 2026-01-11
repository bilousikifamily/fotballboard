import type { PredictionResponse, PredictionsResponse } from "../types";
import { authHeaders, requestJson } from "./client";

export function postPrediction(
  apiBase: string,
  payload: { initData: string; match_id: number; home_pred: number; away_pred: number }
): Promise<{ response: Response; data: PredictionResponse }> {
  return requestJson<PredictionResponse>(`${apiBase}/api/predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function fetchPredictions(
  apiBase: string,
  initData: string,
  matchId: number
): Promise<{ response: Response; data: PredictionsResponse }> {
  return requestJson<PredictionsResponse>(`${apiBase}/api/predictions?match_id=${matchId}`, {
    headers: authHeaders(initData)
  });
}
