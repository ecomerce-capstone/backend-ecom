import bcrypt from "bcryptjs";
//function to hash password
export const hashPassword = async (plain: string) => {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plain, salt);
};
//function to compare password dengan hashed password
export const comparePassword = async (plain: string, hashed: string) => {
  return bcrypt.compare(plain, hashed);
};
