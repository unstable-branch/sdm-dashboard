declare module "geographiclib" {
  export interface GeodesicResult {
    lat1: number;
    lon1: number;
    azi1: number;
    lat2: number;
    lon2: number;
    azi2: number;
    s12: number;
    a12: number;
  }

  export interface GeodesicLine {
    Position(s12: number): GeodesicResult;
  }

  export interface GeodesicPolygonResult {
    number: number;
    perimeter: number;
    area: number;
  }

  export interface GeodesicPolygon {
    AddPoint(lat: number, lon: number): void;
    Compute(force: boolean, reverse: boolean): GeodesicPolygonResult;
  }

  export class Geodesic {
    static WGS84: Geodesic;
    Inverse(lat1: number, lon1: number, lat2: number, lon2: number): GeodesicResult;
    Line(lat1: number, lon1: number, azi1: number): GeodesicLine;
    Polygon(flags?: number): GeodesicPolygon;
  }
}
