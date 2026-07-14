import { Redirect } from 'expo-router';

// Root redirects into the (tabs) group where the recorder lives.
export default function Root() {
  return <Redirect href="/(tabs)/" />;
}
