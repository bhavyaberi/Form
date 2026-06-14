//Checks after any change in input i.e. delete, add, backspace or any action
document.getElementById("name").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("dob").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("email").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("password").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("confirmPassword").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("phone").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("city").addEventListener("input", function () {
    if (submitted) validateForm();
});

document.getElementById("address").addEventListener("input", function () {
    if (submitted) validateForm();
});

//Sets border: Green for valid, Red for invalid 
function setBorder(id, valid) {
    let e = document.getElementById(id);
    if (valid) {
        e.style.border = "2px solid green";
    } else {
        e.style.border = "2px solid red";
    }
}

//Main Validation 
function validateForm(){
                
                //Clear all previous errors
                document.getElementById("nameError").innerHTML="";
                document.getElementById("dobError").innerHTML="";
                document.getElementById("emailError").innerHTML="";
                document.getElementById("passError").innerHTML="";
                document.getElementById("confirmPassError").innerHTML="";
                document.getElementById("phoneError").innerHTML="";
                document.getElementById("cityError").innerHTML="";
                document.getElementById("addressError").innerHTML="";
                
                //Reading input values
                //Clear Spaces which are extra and save info. in variables
                let name=document.getElementById('name').value.trim();
                let dob=document.getElementById('dob').value.trim();
                let email=document.getElementById('email').value.trim();
                let password=document.getElementById('password').value.trim();
                let confirmPassword=document.getElementById('confirmPassword').value.trim();
                let phone=document.getElementById('phone').value.trim();
                let city=document.getElementById('city').value.trim();
                let address=document.getElementById('address').value.trim();

            //Flag
            let isValid=true;

            //Validate Name (Min. 3 + Only alphabets + Underscore(_))
            if (name.length < 3){
                document.getElementById("nameError").innerHTML="Name should have atleast 3 characters.";
                setBorder("name",false);
                isValid=false;}

            else{let namePattern=/^[A-Za-z_]+$/;
                if (!name.match(namePattern)){
                    document.getElementById("nameError").innerHTML="Name should only contain alphabets (A-Z)";
                setBorder("name",false);
                    isValid=false;
                }
                else{
                    setBorder("name",true);
                }
            } 

            // Date of Birth Validation
            // Must be 16 years or older
            if(dob === ""){
                document.getElementById("dobError").innerHTML="Select Date of Birth";
                setBorder("dob",false);
                isValid=false;
            }
            else{
                const date = new Date(dob);
                const today = new Date();
                const minDate = new Date(today.getFullYear() - 16, today.getMonth(), today.getDate());

                if (date > minDate) {
                document.getElementById("dobError").innerHTML="You should be 16 years or above";
                setBorder("dob",false);
                isValid=false;

            }
            else{
                    setBorder("dob",true);
                }}

            // Email Validation
            // Basic pattern check for format
            let emailPattern=/^[^ ]+@[^ ]+\.[a-z]{2,3}$/;
            if (!email.match(emailPattern)){
                document.getElementById("emailError").innerHTML="Enter a valid email id ";
                setBorder("email",false);
                isValid=false;
            }
            else{
                    setBorder("email",true);
                }

            // Password Validation
            // Must include uppercase, lowercase, digit, special char
            let passwordPattern=/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,20}$/;

            if (password.length < 8){
                document.getElementById("passError").innerHTML="Password must be at least 8 characters";
                setBorder("password",false);
                isValid=false;
            }

            if (!password.match(passwordPattern)){
                document.getElementById("passError").innerHTML="Enter a password containing Uppercase, Lowercase, Digit and Special characters";
                setBorder("password",false);
                isValid=false;
            }

            else{
                    setBorder("password",true);
                }

            // Confirm Password Validation
            if (confirmPassword === "") {
                document.getElementById("confirmPassError").innerHTML = "Enter Confirm Password";
                setBorder("confirmPassword", false);
                isValid = false;
            }
            
            else if (password !== confirmPassword) {
                document.getElementById("confirmPassError").innerHTML = "Passwords do not match";
                setBorder("confirmPassword", false);
                isValid = false;
            }

            else {
                setBorder("confirmPassword", true);
            }

            // Phone Number Validation
            // Only 10 digits allowed
            let phonePattern=/^[0-9]{10}$/;
            if(!phone.match(phonePattern)){
                document.getElementById("phoneError").innerHTML="Phone number must be 10 digits";
                setBorder("phone",false);
                isValid=false;
            }
            else{
                    setBorder("phone",true);
                }
            
            // City Validation
            // Must not be empty
            if(city === ""){
                document.getElementById("cityError").innerHTML="Select a city";
                setBorder("city",false);
                isValid=false;
            }
            else{
                    setBorder("city",true);
                }

            // Address Validation
            // Minimum 10 characters
             if (address.length < 10){
                document.getElementById("addressError").innerHTML="Address must be at least 10 characters";
                setBorder("address",false);
                isValid=false;
            }
            else{
                    setBorder("address",true);
                }

    //Return final Validation
    return isValid;

}

// Display input box for 'Other' city
function othercity() {
  var select = document.getElementById("city");
  var other = document.getElementById("otherCity");

  if (select.value == "Other") {
    other.style.display = "block";  //show textbox
  } else {
    other.style.display = "none";   //hide textbox
    other.value = "";   
  }
}

//Final message on successful registration
function showMessage(){
    submitted = true;

    if(validateForm()){
        alert("Registration Successful!");
    }
}