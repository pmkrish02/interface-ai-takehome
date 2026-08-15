export interface Member {
  id: string;
  name: string;
  balance: string;
}

export const members: Record<string, Member> = {
  "12345": { id: "12345", name: "Jane Smith", balance: "$4,200.00" },
  "67890": { id: "67890", name: "Robert Lee", balance: "$12,750.00" },
};

export const validCredentials = {
  username: "admin",
  password: "password123",
};
