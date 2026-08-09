import { createDataProvider } from "./src/components/atomic-crm/providers/fakerest/dataProvider";
import generateData from "./src/components/atomic-crm/providers/fakerest/dataGenerator";

async function testChildGrantsResource() {
  try {
    const db = generateData();
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    // Test that we can get an empty list of child grants
    const result = await dataProvider.getList("child_grants", {
      pagination: { page: 1, perPage: 10 },
    });

    console.log("��✅ SUCCESS: child_grants resource is available");
    console.log(`   Received ${result.data.length} child grants (expected 0)`);
    console.log(`   Total: ${result.total} (expected 0)`);

    // Verify the structure
    if (
      Array.isArray(result.data) &&
      result.data.length === 0 &&
      result.total === 0
    ) {
      console.log(
        "�✅ SUCCESS: child_grants resource returns correct empty structure",
      );
      return true;
    } else {
      console.log(
        "��❌ ERROR: child_grants resource returned unexpected structure",
      );
      return false;
    }
  } catch (error) {
    if (error.message.includes("Undefined collection")) {
      console.log(
        "��❌ ERROR: child_grants resource is still not recognized (Undefined collection)",
      );
      return false;
    } else {
      console.log("��❌ ERROR: Unexpected error:", error.message);
      return false;
    }
  }
}

testChildGrantsResource().then((success) => {
  process.exit(success ? 0 : 1);
});
