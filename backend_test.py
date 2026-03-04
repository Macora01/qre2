import requests
import sys
import json
from datetime import datetime
import time
import subprocess

class BarcodeAppTester:
    def __init__(self):
        # Use the public URL from frontend .env
        self.base_url = "https://scan-deploy-1.preview.emergentagent.com"
        self.api_url = f"{self.base_url}/api"
        self.session_token = None
        self.user_id = None
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        
        default_headers = {'Content-Type': 'application/json'}
        if self.session_token:
            default_headers['Authorization'] = f'Bearer {self.session_token}'
        
        if headers:
            default_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=default_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=default_headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {json.dumps(response_data, indent=2)}")
                    return success, response_data
                except:
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {json.dumps(error_data, indent=2)}")
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except requests.RequestException as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def setup_test_user(self):
        """Create test user and session in MongoDB using mongosh"""
        print("\n🔧 Setting up test user and session...")
        
        timestamp = int(datetime.now().timestamp())
        user_id = f"test-user-{timestamp}"
        session_token = f"test_session_{timestamp}"
        email = f"test.user.{timestamp}@example.com"
        
        mongo_command = f'''
mongosh --eval "
use('test_database');
var userId = '{user_id}';
var sessionToken = '{session_token}';
var userEmail = '{email}';
db.users.insertOne({{
  user_id: userId,
  email: userEmail,
  name: 'Test User {timestamp}',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
}});
db.user_sessions.insertOne({{
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
}});
print('Created user: ' + userId);
print('Session token: ' + sessionToken);
"
'''
        
        try:
            result = subprocess.run(mongo_command, shell=True, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                print("✅ Test user and session created successfully")
                self.session_token = session_token
                self.user_id = user_id
                print(f"   User ID: {user_id}")
                print(f"   Session Token: {session_token}")
                return True
            else:
                print(f"❌ Failed to create test user: {result.stderr}")
                return False
                
        except subprocess.TimeoutExpired:
            print("❌ MongoDB setup timed out")
            return False
        except Exception as e:
            print(f"❌ Error setting up test user: {str(e)}")
            return False

    def test_basic_api(self):
        """Test basic API endpoint"""
        success, _ = self.run_test(
            "Basic API Health Check",
            "GET", 
            "",
            200
        )
        return success

    def test_auth_me(self):
        """Test authenticated user endpoint"""
        success, response = self.run_test(
            "Get Current User (/auth/me)",
            "GET",
            "auth/me",
            200
        )
        
        if success and response:
            # Verify user data structure
            expected_fields = ['user_id', 'email', 'name']
            for field in expected_fields:
                if field not in response:
                    print(f"❌ Missing field in response: {field}")
                    return False
            print(f"✅ User data fields validated")
            
        return success

    def test_session_stats(self):
        """Test session statistics endpoint"""
        success, response = self.run_test(
            "Get Session Stats (/session-stats)",
            "GET",
            "session-stats", 
            200
        )
        
        if success and response:
            expected_fields = ['barcode_count', 'barcodes', 'session_id']
            for field in expected_fields:
                if field not in response:
                    print(f"❌ Missing field in response: {field}")
                    return False
            print(f"✅ Session stats structure validated")
            
        return success

    def test_barcode_submission(self):
        """Test barcode submission endpoint"""
        test_barcode = "1234567890123"
        
        success, response = self.run_test(
            "Submit Barcode (/barcode)",
            "POST",
            "barcode",
            200,
            data={"barcode": test_barcode}
        )
        
        if success and response:
            expected_fields = ['barcode_count', 'barcodes', 'session_id', 'is_duplicate']
            for field in expected_fields:
                if field not in response:
                    print(f"❌ Missing field in response: {field}")
                    return False
                    
            # Check that barcode was added
            if test_barcode not in response.get('barcodes', []):
                print(f"❌ Barcode not found in response barcodes")
                return False
                
            if response.get('barcode_count', 0) < 1:
                print(f"❌ Barcode count not incremented")
                return False
                
            print(f"✅ Barcode submission validated - Count: {response.get('barcode_count')}")
            
        return success

    def test_duplicate_detection(self):
        """Test duplicate barcode detection"""
        duplicate_barcode = "1234567890123"  # Same as previous test
        
        success, response = self.run_test(
            "Submit Duplicate Barcode",
            "POST",
            "barcode", 
            200,
            data={"barcode": duplicate_barcode}
        )
        
        if success and response:
            if not response.get('is_duplicate', False):
                print(f"❌ Duplicate not detected for barcode: {duplicate_barcode}")
                return False
            print(f"✅ Duplicate detection working correctly")
            
        return success

    def test_finalize_session(self):
        """Test session finalization and CSV generation"""
        success, response = self.run_test(
            "Finalize Session (/finalize-session)",
            "POST",
            "finalize-session",
            200
        )
        
        if success and response:
            expected_fields = ['message', 'csv_filename', 'barcode_count']
            for field in expected_fields:
                if field not in response:
                    print(f"❌ Missing field in response: {field}")
                    return False
                    
            csv_filename = response.get('csv_filename')
            if not csv_filename or not csv_filename.startswith('barras_'):
                print(f"❌ Invalid CSV filename: {csv_filename}")
                return False
                
            print(f"✅ Session finalization validated - CSV: {csv_filename}")
            
        return success

    def test_logout(self):
        """Test logout endpoint"""
        success, _ = self.run_test(
            "Logout (/auth/logout)",
            "POST",
            "auth/logout",
            200
        )
        return success

    def cleanup_test_data(self):
        """Clean up test data from MongoDB"""
        if not self.user_id:
            return
            
        print("\n🧹 Cleaning up test data...")
        
        cleanup_command = f'''
mongosh --eval "
use('test_database');
db.users.deleteMany({{user_id: '{self.user_id}'}});
db.user_sessions.deleteMany({{user_id: '{self.user_id}'}});
db.barcode_sessions.deleteMany({{user_id: '{self.user_id}'}});
db.barcode_entries.deleteMany({{user_email: /{self.user_id}/}});
print('Cleanup completed for user: {self.user_id}');
"
'''
        
        try:
            result = subprocess.run(cleanup_command, shell=True, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                print("✅ Test data cleaned up successfully")
            else:
                print(f"⚠️ Cleanup warning: {result.stderr}")
        except Exception as e:
            print(f"⚠️ Error during cleanup: {str(e)}")

    def check_csv_file(self):
        """Check if CSV file was created in /app/data"""
        import os
        import glob
        
        print("\n📄 Checking CSV file creation...")
        
        # Look for CSV files created today
        today = datetime.now().strftime("%Y%m%d")
        pattern = f"/app/data/barras_{today}_v*.csv"
        csv_files = glob.glob(pattern)
        
        if csv_files:
            latest_file = max(csv_files, key=os.path.getctime)
            print(f"✅ CSV file found: {latest_file}")
            
            # Check file content
            try:
                with open(latest_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                    lines = content.strip().split('\n')
                    
                    if len(lines) < 2:
                        print(f"❌ CSV file appears empty or has no data")
                        return False
                        
                    header = lines[0]
                    if header != "timestamp,codigo,usuario":
                        print(f"❌ Incorrect CSV header: {header}")
                        return False
                        
                    print(f"✅ CSV format validated - {len(lines)-1} data rows")
                    print(f"   Header: {header}")
                    if len(lines) > 1:
                        print(f"   Sample: {lines[1]}")
                    
                return True
                
            except Exception as e:
                print(f"❌ Error reading CSV file: {str(e)}")
                return False
        else:
            print(f"❌ No CSV files found matching pattern: {pattern}")
            return False

def main():
    tester = BarcodeAppTester()
    
    print("🚀 Starting Barcode Scanner API Tests")
    print("=" * 50)
    
    try:
        # Setup test environment
        if not tester.setup_test_user():
            print("❌ Failed to setup test environment")
            return 1

        # Run API tests
        tests = [
            tester.test_basic_api,
            tester.test_auth_me,
            tester.test_session_stats,
            tester.test_barcode_submission,
            tester.test_duplicate_detection,
            tester.test_finalize_session,
            tester.check_csv_file,
            tester.test_logout,
        ]
        
        for test in tests:
            try:
                if not test():
                    print(f"❌ Test failed: {test.__name__}")
            except Exception as e:
                print(f"❌ Test error in {test.__name__}: {str(e)}")
        
        # Print final results
        print("\n" + "=" * 50)
        print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
        
        if tester.tests_passed == tester.tests_run:
            print("🎉 All backend tests PASSED!")
            return_code = 0
        else:
            print("⚠️ Some backend tests FAILED!")
            return_code = 1
            
        return return_code
        
    finally:
        # Always cleanup
        tester.cleanup_test_data()

if __name__ == "__main__":
    sys.exit(main())