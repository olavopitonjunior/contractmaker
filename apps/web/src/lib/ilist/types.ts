// Shapes da RexAPI (Gryphtech) — campos observados ao vivo na região 71.
// A API devolve mais campos do que os tipados aqui; o que não usamos fica em
// index signature implícita via `raw` no espelho.

export interface IListPagedResponse<T> {
  PageIndex: number;
  PageSize: number;
  TotalCount: number;
  TotalPageCount: number;
  HasNextPage: boolean;
  HasPreviousPage: boolean;
  Items: T[];
}

export interface IListGeoData {
  CityID?: number;
  LocalZoneID?: number;
}

export interface IListOffice {
  ID: number;
  ExternalID?: string;
  IntegratorID: number;
  RegionID: number;
  OfficeName?: string;
  Address1?: string;
  Address2?: string;
  PostalCode?: string;
  Email?: string;
  Phone?: string;
  GeoData?: IListGeoData;
  Terminated?: boolean;
  ModifiedDate?: string;
  // IListCredentials é REMOVIDO pelo client (redactIListCredentials) — nunca
  // aparece a jusante. Mantido fora do tipo de propósito.
}

export interface IListAssociate {
  ID: number;
  ExternalID?: string;
  IntegratorID: number;
  RegionID: number;
  OfficeID?: number;
  OfficeExternalID?: string;
  FirstName?: string;
  LastName?: string;
  AgentName?: string;
  Email?: string;
  Phone?: string;
  SalesLicenseNumber?: string; // CRECI
  ImageURL?: string;
  Terminated?: boolean;
  Hidden?: boolean;
  IsSalesAssociate?: boolean;
  ModifiedDate?: string;
}

export interface IListProperty {
  IntegratorID: number;
  /** STRING composta (ex. "710031017-6") — chave estável de dedupe. */
  ID: string;
  ExternalID?: string;
  ListingID?: number;
  RegionID: number;
  OfficeID?: number;
  OfficeExternalID?: string;
  AssociateID?: number;
  AssociateExternalID?: string;
  Disabled?: boolean;
  CommercialResidential?: number; // 1 Commercial | 2 Residential
  StreetName?: string;
  StreetNumber?: string;
  PostalCode?: string;
  GeoData?: IListGeoData;
  GeoCoordinates?: { Latitude?: number; Longitude?: number };
  CurrentListingPrice?: number; // -999 = vazio (normalizado pelo client → undefined)
  CurrentListingCurrency?: string;
  PriceType?: number;
  HidePricePublic?: boolean;
  ShowAddressOnWeb?: boolean;
  TransactionType?: number; // 261 Sale | 260 Rent
  ContractType?: number;
  PropertyStatus?: number;
  PropertyType?: number;
  PropertyCategory?: number;
  ListingStatus?: number;
  MarketStatus?: number;
  LotSizeM2?: number;
  BuiltArea?: number;
  ParkingSpaces?: number;
  TotalNumOfRooms?: number;
  NumberOfBathrooms?: number;
  NumberOfBedrooms?: number;
  NumberOfFloors?: number;
  YearBuilt?: number;
  OrigListingDate?: string;
  ExpiryDate?: string;
  SoldDate?: string;
  Features?: string; // CSV de UIDs
  ComTotalPct?: number;
  ComBuyAgentPct?: number;
  IsPublicAvailable?: boolean;
  IsOnPublicWebSite?: boolean;
  CreatedDate?: string;
  ModifiedDate?: string;
}

export interface IListPropertyDescription {
  IntegratorID: number;
  PropertyID: string;
  PropertyExternalID?: string;
  LanguageCode: string; // "PTB", "ENU"...
  DescriptionText: string;
  DescriptionType: number; // 629 Web, 1113 ListingTitle...
  ModifiedDate?: string;
}

export interface IListPropertyImage {
  IntegratorID: number;
  PropertyID: string;
  ID: number;
  SequenceNumber?: number;
  ImageURL?: string; // nome do arquivo — montar com ilistImageUrl()
  DescriptiveName?: string;
  IsDefault?: boolean;
  HasLargeImage?: number;
}

export interface IListGeoCityRow {
  CountryID?: number;
  RegionID?: number;
  ProvinceID?: number;
  ProvinceName?: string;
  CityID: number;
  CityName: string;
  HasLocalZones?: boolean;
}

export interface IListLookupItem {
  Name?: string;
  Value?: string;
  UID?: number | string;
}
