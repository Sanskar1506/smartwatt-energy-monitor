import axios from "axios";
export const api=axios.create({baseURL:import.meta.env.VITE_API_URL||"http://localhost:4000/api",timeout:8000});
export type Reading={id?:number;deviceId:string;timestamp:string;voltage:number;current:number;power:number;energy:number;powerFactor:number;frequency:number;temperature:number;source:string};
