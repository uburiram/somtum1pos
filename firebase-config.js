/**
 * วางค่าจาก Firebase Console → Project settings → Your apps → Web app
 * โปรเจกต์: pos1-4d72a
 *
 * วิธีเอาค่า (มือถือ):
 * 1. เปิด https://console.firebase.google.com/project/pos1-4d72a/settings/general
 * 2. เลื่อนลง "Your apps" → ถ้ายังไม่มี กด </>(Web) ตั้งชื่อ pos-web แล้ว Register
 * 3. คัดลอก object firebaseConfig มาวางแทนด้านล่าง
 */
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC4aJKI-HbwWhA6AcZqOS5Wx8ShKvCWN8U",
  authDomain: "pos1-4d72a.firebaseapp.com",
  projectId: "pos1-4d72a",
  storageBucket: "pos1-4d72a.firebasestorage.app",
  messagingSenderId: "598519354918",
  appId: "1:598519354918:web:c41df74ea126644725f8e7",
  measurementId: "G-NK6YKVT17J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
/** รหัสร้าน — ใช้แยกข้อมูลถ้าระบบมีหลายสาขา (ตอนนี้ใช้ค่าเดียว) */
window.SHOP_ID = "main";

/** PIN ร้านค้า (เก็บบนเครื่องร้าน + ตรวจในหน้า pos) */
window.DEFAULT_PIN = "1234";
