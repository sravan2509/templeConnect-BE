import axios from "axios";
import { env } from "../config/env";

export interface BirthChartInput {
  dob: string;
  time: string;
  lat: number;
  lon: number;
}

export interface BirthChartResult {
  nakshatra: string;
  rashi: string;
}

export async function calculateBirthChart(input: BirthChartInput): Promise<BirthChartResult> {
  const { data } = await axios.post(`${env.swissEphemerisBaseUrl}/calculate`, input);
  return { nakshatra: data.nakshatra, rashi: data.rashi };
}
