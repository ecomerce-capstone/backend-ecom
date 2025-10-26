///semua ini adalah tipe data
// Generated interfaces matching the provided SQL schema (emarket_multivendor).
// DATETIME fields are represented as string (ISO datetime).
// DECIMAL fields are represented as string to preserve precision; you may cast to number in business logic if desired.

export interface User {
  id: string;
  full_name: string;
  email: string;
  password: string;
  phone?: string | null;
  avatar_url?: string | null;
  avatar_public_id?: string | null;
  status?: string | null;
  created_at: string; //// DATETIME
  updated_at?: string | null; //// DATETIME
}

export interface Vendor {
  id: number;
  name: number | string;
  email: string;
  password: string;
  phone?: string | null;
  store_name: string;
  store_slug?: string | null;
  store_description?: string | null;
  store_image_url?: string | null;
  store_image_public_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Product {
  id: string;
  vendor_id: string;
  category_id?: string | null;
  name: string;
  slug: string;
  sku?: string | null;
  price: string; // decimal(2,12) stored as string
  quantity: number;
  short_description?: string | null;
  description?: string | null;
  popular: 0 | 1;
  recommend: 0 | 1;
  created_at: string;
  updated_at?: string | null;
}

export interface ProductImage {
  id: number;
  prodiuct_id: number;
  url: string;
  public_id?: string | null;
  sort_order: number;
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface ProductReview {
  id: number;
  product_id: number;
  buyer_id?: number | null;
  rating: number;
  review?: string | null;
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface Order {
  id: number;
  user_id: number;
  vendor_id?: number | null;
  parent_order_id?: number | null;
  total_amount: string; // decimal(2,12) stored as string
  status: string;
  shipping_address?: string | null;
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id?: number | null;
  quantity: number;
  unit_price: string; //decimal(12,2)
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface Cart {
  id: number;
  user_id: number;
  currency: string;
  total_amount: string; //decimal(12,2)
  item_count: number;
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface Payment {
  id: number;
  order_id: number;
  provider?: string | null;
  provider_payment_id?: string | null;
  linked_payment_id?: number | null;
  amount: string; // decimal(12,2)
  status: string;
  metadata?: any | null; //JSON
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface CartItem {
  id: number;
  cart_id: number;
  product_id?: number | null;
  vendor_id?: number | null;
  product_name?: string;
  product_price: string; //decimal(12,2)
  quantity: number;
  option?: any | null; //JSON
  image_url?: string | null;
  created_at: string;
  updated_at?: string | null; //kasih optional
}

export interface Banner {
  id: number;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  public_id?: string | null;
  target_url?: string | null;
  is_active: 0 | 1;
  sort_order: number;
  start_at?: string | null;
  end_at?: string | null;
  created_at: string;
  updated_at: string;
}

// Roles and mapping (from your earlier schema references)
export interface Role {
  id: number;
  name: string;
  description?: string | null;
}

export interface UserHasRole {
  user_id: number;
  role_id: number;
}
