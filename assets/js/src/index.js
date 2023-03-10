		$(document).ready(function () {
			$(".nav-link").on("click", function () {
				$(".nav-link.active ").removeClass("active");
				$(this).addClass("active ");
			});
			$(".pricing-card").on("click", function () {
				$(".pricing-card-active").addClass("pricing-card");
				$(".pricing-card-active").removeClass("pricing-card-active");
				$(this).removeClass("pricing-card");
				$(this).addClass("pricing-card-active");
			});

			$(".pricing-card-active").on("click", function () {
				console.log("this is");
				$(".pricing-card-active").addClass("pricing-card");
				$(".pricing-card-active").removeClass("pricing-card-active");
				$(this).removeClass("pricing-card");
				$(this).addClass("pricing-card-active");
			});

			$("#btnContact").click(function () {
				$(this).preventDefault();
				var email = $("#email1").val();
				console.log(email);
				$("#emailModal").val(email);
			});

			$("#btnSubmit").click(function () {
				var forms = document.querySelectorAll(".needs-validation");

				// Loop over them and prevent submission
				Array.prototype.slice.call(forms).forEach(function (form) {
					form.addEventListener(
						"submit",
						function (event) {
							if (!form.checkValidity()) {
								event.preventDefault();
								event.stopPropagation();
							} else { }
							form.classList.add("was-validated");

						},
						false
					);
				});
			});

			$("#bundle-plan-tab").click(function () {
				$("#text-annually").text("-15%");
				$("#text-monthly").text("-10%");
			});

			$("#user-plan-tab").click(function () {
				$("#text-annually").text("-10%");
				$("#text-monthly").text("");
			});
		});