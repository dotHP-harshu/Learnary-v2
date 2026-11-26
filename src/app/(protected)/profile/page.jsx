import ProfilePage from "../../../components/profile/ProfilePage";

export const metadata = {
  title: "Profile",
};

// My Profile page: account details, learning profile and the usage dashboard.
// /settings redirects here so existing links keep working.
export default function Profile() {
  return <ProfilePage />;
}
